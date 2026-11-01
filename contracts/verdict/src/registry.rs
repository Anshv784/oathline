//! Admitting a model: from a fresh nonce to a registered signing key.
//!
//! 1. Anyone calls [`start_registration`](Verdict::start_registration) for a
//!    model that has a policy, and gets a nonce from this contract.
//! 2. They fetch the model's attestation from NEAR AI with that nonce and
//!    submit it to [`register_model`](Verdict::register_model).
//! 3. `tee-verifier` checks the Intel quote. The callback then applies the
//!    binding rules from `verdict_core::attestation` and, if all pass,
//!    stores the model's signing key until the registration expires.
//!
//! Because the nonce comes from this contract and is used once, evidence
//! cannot be recorded earlier or replayed later.

use near_sdk::json_types::U64;
use near_sdk::{env, near, require, AccountId, Gas, NearToken, Promise, PromiseError};
use tee_verifier_interface::{QuoteBytes, TDReport10, VerificationResult, VerifiedReport};
use verdict_core::attestation::{
    verify_model_evidence, ImageMeasurements, ModelEvidence, ModelPolicy, Rtmr3Event, TdReport,
};

use crate::external::ext_tee_verifier;
use crate::views::{ModelView, PolicyView, RegistrationEvidence, RegistrationOutcome};
use crate::{events, Verdict, VerdictExt};

/// How long a nonce stays valid for submitting evidence.
pub const CHALLENGE_TTL_MS: u64 = 10 * 60 * 1000;
/// Covers the challenge's storage; refunded when the registration resolves.
pub const CHALLENGE_DEPOSIT: NearToken = NearToken::from_millinear(20);
/// What near/mpc attaches for the same call.
const VERIFY_QUOTE_GAS: Gas = Gas::from_tgas(200);
const ON_QUOTE_VERIFIED_GAS: Gas = Gas::from_tgas(40);

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoredImage {
    pub mr_td: [u8; 48],
    pub rt_mr0: [u8; 48],
    pub rt_mr1: [u8; 48],
    pub rt_mr2: [u8; 48],
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoredPolicy {
    pub images: Vec<StoredImage>,
    pub compose_hashes: Vec<[u8; 32]>,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RegisteredModel {
    pub signing_address: [u8; 20],
    pub compose_hash: [u8; 32],
    pub image: StoredImage,
    pub tcb_status: String,
    pub registered_by: AccountId,
    pub registered_at_ms: u64,
    pub expires_at_ms: u64,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Challenge {
    pub model: String,
    pub requester: AccountId,
    pub deposit: NearToken,
    pub expires_at_ms: u64,
}

/// One RTMR3 event log entry, decoded.
#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoredEvent {
    pub event_type: u32,
    pub event: String,
    pub payload: Vec<u8>,
    pub digest: Option<[u8; 48]>,
}

/// Evidence carried to the callback while `tee-verifier` checks the quote.
#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct PendingRegistration {
    pub model: String,
    pub nonce: [u8; 32],
    pub signing_address: [u8; 20],
    pub app_compose: String,
    pub events: Vec<StoredEvent>,
    pub requester: AccountId,
    pub deposit: NearToken,
    pub submitted_by: AccountId,
}

impl From<&StoredImage> for ImageMeasurements {
    fn from(image: &StoredImage) -> Self {
        Self {
            mr_td: image.mr_td,
            rt_mr0: image.rt_mr0,
            rt_mr1: image.rt_mr1,
            rt_mr2: image.rt_mr2,
        }
    }
}

impl From<ImageMeasurements> for StoredImage {
    fn from(image: ImageMeasurements) -> Self {
        Self {
            mr_td: image.mr_td,
            rt_mr0: image.rt_mr0,
            rt_mr1: image.rt_mr1,
            rt_mr2: image.rt_mr2,
        }
    }
}

impl From<&StoredPolicy> for ModelPolicy {
    fn from(policy: &StoredPolicy) -> Self {
        Self {
            images: policy.images.iter().map(ImageMeasurements::from).collect(),
            compose_hashes: policy.compose_hashes.clone(),
        }
    }
}

fn td_report(report: &TDReport10) -> TdReport {
    TdReport {
        td_attributes: report.td_attributes,
        mr_td: report.mr_td,
        mr_config_id: report.mr_config_id,
        rt_mr0: report.rt_mr0,
        rt_mr1: report.rt_mr1,
        rt_mr2: report.rt_mr2,
        rt_mr3: report.rt_mr3,
        report_data: report.report_data,
    }
}

#[near]
impl Verdict {
    /// Sets which VM images and app configurations count as `model`.
    /// Replacing a policy revokes the current registration: the key must be
    /// proven again under the new rules.
    pub fn set_model_policy(&mut self, model: String, policy: PolicyView) {
        self.assert_owner();
        let stored = policy.into_stored();
        require!(
            !stored.images.is_empty(),
            "a policy needs at least one image"
        );
        require!(
            !stored.compose_hashes.is_empty(),
            "a policy needs at least one compose hash"
        );
        self.models.remove(&model);
        events::policy_set(&model);
        self.policies.insert(model, stored);
    }

    /// Removes a model entirely. Pending answers from it will be refused.
    pub fn remove_model(&mut self, model: String) {
        self.assert_owner();
        self.policies.remove(&model);
        if self.models.remove(&model).is_some() {
            events::model_revoked(&model);
        }
    }

    /// Issues a single-use nonce to fetch `model`'s attestation with.
    #[payable]
    pub fn start_registration(&mut self, model: String) -> String {
        require!(
            self.policies.contains_key(&model),
            "no policy for this model"
        );
        let deposit = env::attached_deposit();
        require!(
            deposit >= CHALLENGE_DEPOSIT,
            "attach 0.02 NEAR; it is refunded"
        );
        let nonce = self.fresh_nonce(model.as_bytes());
        let expires_at_ms = env::block_timestamp_ms() + CHALLENGE_TTL_MS;
        self.challenges.insert(
            nonce,
            Challenge {
                model: model.clone(),
                requester: env::predecessor_account_id(),
                deposit,
                expires_at_ms,
            },
        );
        let nonce = hex::encode(nonce);
        events::challenge_issued(&model, &nonce, expires_at_ms);
        nonce
    }

    /// Submits the attestation fetched with `evidence.nonce`. The nonce is
    /// spent whatever the outcome.
    pub fn register_model(&mut self, evidence: RegistrationEvidence) -> Promise {
        let nonce: [u8; 32] = hex::decode(&evidence.nonce)
            .ok()
            .and_then(|bytes| bytes.try_into().ok())
            .unwrap_or_else(|| env::panic_str("nonce must be 32 hex-encoded bytes"));
        let challenge = self
            .challenges
            .remove(&nonce)
            .unwrap_or_else(|| env::panic_str("unknown or used nonce"));
        require!(
            env::block_timestamp_ms() <= challenge.expires_at_ms,
            "nonce expired"
        );
        require!(
            env::prepaid_gas()
                >= VERIFY_QUOTE_GAS
                    .saturating_add(ON_QUOTE_VERIFIED_GAS)
                    .saturating_add(Gas::from_tgas(20)),
            "attach at least 260 Tgas"
        );

        let quote = hex::decode(evidence.intel_quote.trim_start_matches("0x"))
            .unwrap_or_else(|_| env::panic_str("intel_quote must be hex"));
        let signing_address = verdict_core::inference::decode_address(&evidence.signing_address)
            .unwrap_or_else(|| env::panic_str("signing_address must be 20 hex-encoded bytes"));
        let events = evidence.rtmr3_events();

        let pending = PendingRegistration {
            model: challenge.model,
            nonce,
            signing_address,
            app_compose: evidence.app_compose,
            events,
            requester: challenge.requester,
            deposit: challenge.deposit,
            submitted_by: env::predecessor_account_id(),
        };

        ext_tee_verifier::ext(self.tee_verifier.clone())
            .with_static_gas(VERIFY_QUOTE_GAS)
            .verify_quote(QuoteBytes(quote), evidence.collateral.into_collateral())
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(ON_QUOTE_VERIFIED_GAS)
                    .on_quote_verified(pending),
            )
    }

    /// Returns the deposit of a nonce that expired unused.
    pub fn reclaim_challenge(&mut self, nonce: String) {
        let nonce: [u8; 32] = hex::decode(&nonce)
            .ok()
            .and_then(|bytes| bytes.try_into().ok())
            .unwrap_or_else(|| env::panic_str("nonce must be 32 hex-encoded bytes"));
        let challenge = self
            .challenges
            .get(&nonce)
            .unwrap_or_else(|| env::panic_str("unknown or used nonce"));
        require!(
            env::block_timestamp_ms() > challenge.expires_at_ms,
            "nonce has not expired yet"
        );
        let challenge = self.challenges.remove(&nonce).expect("checked above");
        Promise::new(challenge.requester)
            .transfer(challenge.deposit)
            .detach();
    }

    #[private]
    pub fn on_quote_verified(
        &mut self,
        #[serializer(borsh)] pending: PendingRegistration,
        #[serializer(borsh)]
        #[callback_result]
        result: Result<VerificationResult, PromiseError>,
    ) -> RegistrationOutcome {
        Promise::new(pending.requester.clone())
            .transfer(pending.deposit)
            .detach();

        let outcome = match result {
            Err(_) => Err("tee-verifier did not answer".to_owned()),
            Ok(VerificationResult::Rejected(error)) => {
                Err(format!("Intel quote rejected: {error}"))
            }
            Ok(VerificationResult::Verified(report)) => self.admit(&pending, &report),
        };

        match outcome {
            Ok(model) => {
                events::model_registered(&pending.model, &model);
                RegistrationOutcome::Registered {
                    model: ModelView::new(&pending.model, &model),
                }
            }
            Err(reason) => {
                events::registration_rejected(&pending.model, &reason);
                RegistrationOutcome::Rejected { reason }
            }
        }
    }

    pub fn get_policy(&self, model: String) -> Option<PolicyView> {
        self.policies.get(&model).map(PolicyView::from_stored)
    }

    pub fn get_model(&self, model: String) -> Option<ModelView> {
        self.models
            .get(&model)
            .map(|registered| ModelView::new(&model, registered))
    }

    /// Every model with a policy, registered or not.
    pub fn list_models(&self) -> Vec<(String, Option<ModelView>)> {
        self.policies
            .keys()
            .map(|model| {
                (
                    model.clone(),
                    self.models.get(model).map(|m| ModelView::new(model, m)),
                )
            })
            .collect()
    }

    pub fn get_challenge_expiry(&self, nonce: String) -> Option<U64> {
        let nonce: [u8; 32] = hex::decode(nonce).ok()?.try_into().ok()?;
        self.challenges
            .get(&nonce)
            .map(|challenge| challenge.expires_at_ms.into())
    }
}

impl Verdict {
    fn admit(
        &mut self,
        pending: &PendingRegistration,
        verified: &VerifiedReport,
    ) -> Result<RegisteredModel, String> {
        if !self.accepted_tcb_statuses.contains(&verified.status) {
            return Err(format!("TCB status {} is not accepted", verified.status));
        }
        let report = verified
            .report
            .as_td10()
            .ok_or("quote is not from a TDX VM")?;
        let policy = ModelPolicy::from(
            self.policies
                .get(&pending.model)
                .ok_or("model policy was removed")?,
        );

        let events: Vec<Rtmr3Event> = pending
            .events
            .iter()
            .map(|stored| Rtmr3Event {
                event_type: stored.event_type,
                event: stored.event.clone(),
                payload: stored.payload.clone(),
                digest: stored.digest,
            })
            .collect();
        let evidence = ModelEvidence {
            signing_address: pending.signing_address,
            app_compose: &pending.app_compose,
            rtmr3_events: &events,
        };
        let attested =
            verify_model_evidence(&td_report(report), &evidence, &pending.nonce, &policy)
                .map_err(|error| error.to_string())?;

        let now = env::block_timestamp_ms();
        let registered = RegisteredModel {
            signing_address: attested.signing_address,
            compose_hash: attested.compose_hash,
            image: attested.image.into(),
            tcb_status: verified.status.clone(),
            registered_by: pending.submitted_by.clone(),
            registered_at_ms: now,
            expires_at_ms: now + self.registration_ttl_ms,
        };
        self.models
            .insert(pending.model.clone(), registered.clone());
        Ok(registered)
    }
}
