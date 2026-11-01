//! JSON shapes for arguments and views. Byte strings are lowercase hex,
//! except the response body, which is base64 because it is JSON itself.

use base64::Engine;
use near_sdk::json_types::U64;
use near_sdk::{env, near, AccountId};
use tee_verifier_interface::Collateral;

use crate::registry::{RegisteredModel, StoredDeployment, StoredEvent, StoredImage, StoredPolicy};
use crate::requests::{Request, Status};
use crate::{Runner, Secrets};

fn hex_array<const N: usize>(text: &str, field: &str) -> [u8; N] {
    hex::decode(text.trim_start_matches("0x"))
        .ok()
        .and_then(|bytes| bytes.try_into().ok())
        .unwrap_or_else(|| env::panic_str(&format!("{field} must be {N} hex-encoded bytes")))
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ImageView {
    pub mr_td: String,
    pub rt_mr0: String,
    pub rt_mr1: String,
    pub rt_mr2: String,
}

impl ImageView {
    fn from_stored(image: &StoredImage) -> Self {
        Self {
            mr_td: hex::encode(image.mr_td),
            rt_mr0: hex::encode(image.rt_mr0),
            rt_mr1: hex::encode(image.rt_mr1),
            rt_mr2: hex::encode(image.rt_mr2),
        }
    }

    fn into_stored(self) -> StoredImage {
        StoredImage {
            mr_td: hex_array(&self.mr_td, "mr_td"),
            rt_mr0: hex_array(&self.rt_mr0, "rt_mr0"),
            rt_mr1: hex_array(&self.rt_mr1, "rt_mr1"),
            rt_mr2: hex_array(&self.rt_mr2, "rt_mr2"),
        }
    }
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DeploymentView {
    pub image: ImageView,
    pub compose_hash: String,
}

/// The deployments a model may be served from. See
/// `verdict_core::attestation::Deployment`.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PolicyView {
    pub deployments: Vec<DeploymentView>,
}

impl PolicyView {
    pub(crate) fn from_stored(policy: &StoredPolicy) -> Self {
        Self {
            deployments: policy
                .deployments
                .iter()
                .map(|deployment| DeploymentView {
                    image: ImageView::from_stored(&deployment.image),
                    compose_hash: hex::encode(deployment.compose_hash),
                })
                .collect(),
        }
    }

    pub(crate) fn into_stored(self) -> StoredPolicy {
        StoredPolicy {
            deployments: self
                .deployments
                .into_iter()
                .map(|deployment| StoredDeployment {
                    compose_hash: hex_array(&deployment.compose_hash, "compose_hash"),
                    image: deployment.image.into_stored(),
                })
                .collect(),
        }
    }
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ModelView {
    pub model: String,
    pub signing_address: String,
    pub compose_hash: String,
    pub image: ImageView,
    pub tcb_status: String,
    pub registered_by: AccountId,
    pub registered_at_ms: U64,
    pub expires_at_ms: U64,
}

impl ModelView {
    pub(crate) fn new(model: &str, registered: &RegisteredModel) -> Self {
        Self {
            model: model.to_owned(),
            signing_address: format!("0x{}", hex::encode(registered.signing_address)),
            compose_hash: hex::encode(registered.compose_hash),
            image: ImageView::from_stored(&registered.image),
            tcb_status: registered.tcb_status.clone(),
            registered_by: registered.registered_by.clone(),
            registered_at_ms: registered.registered_at_ms.into(),
            expires_at_ms: registered.expires_at_ms.into(),
        }
    }
}

/// One entry of the model's `event_log`, as NEAR AI returns it.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct EventLogEntry {
    pub imr: u32,
    pub event_type: u32,
    pub event: String,
    pub event_payload: String,
    #[serde(default)]
    pub digest: String,
}

/// A NEAR AI model attestation, fetched with a nonce from `start_registration`,
/// plus the Intel collateral for its quote.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct RegistrationEvidence {
    pub nonce: String,
    pub signing_address: String,
    pub intel_quote: String,
    pub app_compose: String,
    pub event_log: Vec<EventLogEntry>,
    pub collateral: CollateralView,
}

/// Intel collateral for a quote, in the JSON shape dcap-qvl produces
/// (`QuoteCollateralV3`): byte fields are hex strings.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct CollateralView {
    pub pck_crl_issuer_chain: String,
    pub root_ca_crl: String,
    pub pck_crl: String,
    pub tcb_info_issuer_chain: String,
    pub tcb_info: String,
    pub tcb_info_signature: String,
    pub qe_identity_issuer_chain: String,
    pub qe_identity: String,
    pub qe_identity_signature: String,
    #[serde(default)]
    pub pck_certificate_chain: Option<String>,
}

impl CollateralView {
    pub(crate) fn into_collateral(self) -> Collateral {
        let bytes = |text: &str, field: &str| {
            hex::decode(text)
                .unwrap_or_else(|_| env::panic_str(&format!("collateral.{field} must be hex")))
        };
        Collateral {
            root_ca_crl: bytes(&self.root_ca_crl, "root_ca_crl"),
            pck_crl: bytes(&self.pck_crl, "pck_crl"),
            tcb_info_signature: bytes(&self.tcb_info_signature, "tcb_info_signature"),
            qe_identity_signature: bytes(&self.qe_identity_signature, "qe_identity_signature"),
            pck_crl_issuer_chain: self.pck_crl_issuer_chain,
            tcb_info_issuer_chain: self.tcb_info_issuer_chain,
            tcb_info: self.tcb_info,
            qe_identity_issuer_chain: self.qe_identity_issuer_chain,
            qe_identity: self.qe_identity,
            pck_certificate_chain: self.pck_certificate_chain,
        }
    }
}

impl RegistrationEvidence {
    /// The RTMR3 entries, decoded. Entries for other registers are dropped:
    /// they are covered by the image measurements instead.
    pub(crate) fn rtmr3_events(&self) -> Vec<StoredEvent> {
        self.event_log
            .iter()
            .filter(|entry| entry.imr == 3)
            .map(|entry| {
                let payload = hex::decode(&entry.event_payload)
                    .unwrap_or_else(|_| env::panic_str("event_payload must be hex"));
                let digest = (!entry.digest.is_empty()).then(|| hex_array(&entry.digest, "digest"));
                StoredEvent {
                    event_type: entry.event_type,
                    event: entry.event.clone(),
                    payload,
                    digest,
                }
            })
            .collect()
    }
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum RegistrationOutcome {
    Registered { model: ModelView },
    Rejected { reason: String },
}

/// What a consumer learns about its question.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum Outcome {
    Pending,
    Answered { answer: String, reason: String },
    Failed { reason: String },
}

impl From<&Status> for Outcome {
    fn from(status: &Status) -> Self {
        match status {
            Status::Pending => Self::Pending,
            Status::Answered { answer, reason, .. } => Self::Answered {
                answer: answer.clone(),
                reason: reason.clone(),
            },
            Status::Failed { reason } => Self::Failed {
                reason: reason.clone(),
            },
        }
    }
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SignatureView {
    pub text: String,
    pub signature: String,
    pub signing_address: String,
    pub signing_algo: String,
    pub signature_kind: Option<String>,
}

/// Everything needed to check an answer again without trusting this contract:
/// rebuild the body from the fields, hash it, hash `response_base64`, and
/// recover the signer of `signature.text`.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RequestView {
    pub id: U64,
    pub requester: AccountId,
    pub model: String,
    pub signer: String,
    pub instructions: String,
    pub submission: String,
    pub options: Vec<String>,
    pub tag: String,
    pub request_hash: String,
    pub created_at_ms: U64,
    pub outcome: Outcome,
    pub completion_id: Option<String>,
    pub response_base64: Option<String>,
    pub signature: Option<SignatureView>,
    pub answered_at_ms: Option<U64>,
}

impl RequestView {
    pub(crate) fn new(id: u64, request: &Request) -> Self {
        let (completion_id, response_base64, signature, answered_at_ms) = match &request.status {
            Status::Answered {
                completion_id,
                response,
                signature,
                answered_at_ms,
                ..
            } => (
                Some(completion_id.clone()),
                Some(base64::engine::general_purpose::STANDARD.encode(response)),
                Some(SignatureView {
                    text: signature.text.clone(),
                    signature: signature.signature.clone(),
                    signing_address: signature.signing_address.clone(),
                    signing_algo: signature.signing_algo.clone(),
                    signature_kind: signature.signature_kind.clone(),
                }),
                Some(U64(*answered_at_ms)),
            ),
            _ => (None, None, None, None),
        };
        Self {
            id: U64(id),
            requester: request.requester.clone(),
            model: request.model.clone(),
            signer: format!("0x{}", hex::encode(request.signer)),
            instructions: request.instructions.clone(),
            submission: request.submission.clone(),
            options: request.options.clone(),
            tag: request.tag.clone(),
            request_hash: hex::encode(request.request_hash),
            created_at_ms: U64(request.created_at_ms),
            outcome: Outcome::from(&request.status),
            completion_id,
            response_base64,
            signature,
            answered_at_ms,
        }
    }
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CheckView {
    pub accepted: bool,
    pub answer: Option<String>,
    pub reason: Option<String>,
    pub error: Option<String>,
}

impl CheckView {
    pub(crate) fn accepted(answer: String, reason: String) -> Self {
        Self {
            accepted: true,
            answer: Some(answer),
            reason: Some(reason),
            error: None,
        }
    }

    pub(crate) fn rejected(error: &str) -> Self {
        Self {
            accepted: false,
            answer: None,
            reason: None,
            error: Some(error.to_owned()),
        }
    }
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConfigView {
    pub owner_id: AccountId,
    pub tee_verifier: AccountId,
    pub outlayer: AccountId,
    pub runner: Runner,
    pub secrets: Secrets,
    pub registration_ttl_ms: U64,
    pub accepted_tcb_statuses: Vec<String>,
}
