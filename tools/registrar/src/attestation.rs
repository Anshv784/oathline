//! A NEAR AI model attestation, and the same checks the contract applies.

use anyhow::{anyhow, bail, Context, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use verdict_core::attestation::{
    verify_model_evidence, Deployment, ImageMeasurements, ModelEvidence, ModelPolicy, Rtmr3Event,
    TdReport,
};

pub const NEAR_AI: &str = "https://cloud-api.near.ai";

#[derive(Debug, Clone, Deserialize)]
pub struct EventLogEntry {
    pub imr: u32,
    pub event_type: u32,
    pub event: String,
    pub event_payload: String,
    #[serde(default)]
    pub digest: String,
}

/// One `model_attestations[]` candidate, as returned by
/// `GET /v1/attestation/report?provider=near`.
#[derive(Debug, Clone)]
pub struct ModelAttestation {
    pub model: String,
    pub signing_address: String,
    pub signing_algo: String,
    pub intel_quote: Vec<u8>,
    pub event_log: Vec<EventLogEntry>,
    pub app_compose: String,
}

impl ModelAttestation {
    fn from_json(value: &Value) -> Result<Self> {
        let text = |path: &[&str]| -> Result<String> {
            let mut node = value;
            for key in path {
                node = &node[*key];
            }
            node.as_str()
                .map(str::to_owned)
                .with_context(|| format!("missing {}", path.join(".")))
        };
        // The gateway returns the event log as a JSON string; some reports
        // inline it as an array.
        let event_log = match &value["event_log"] {
            Value::String(encoded) => serde_json::from_str(encoded)?,
            other => serde_json::from_value(other.clone())?,
        };
        Ok(Self {
            model: text(&["model_name"])?,
            signing_address: text(&["signing_address"])?,
            signing_algo: text(&["signing_algo"])?,
            intel_quote: hex::decode(text(&["intel_quote"])?).context("intel_quote is not hex")?,
            event_log,
            app_compose: text(&["info", "tcb_info", "app_compose"])?,
        })
    }

    pub fn rtmr3_events(&self) -> Result<Vec<Rtmr3Event>> {
        self.event_log
            .iter()
            .filter(|entry| entry.imr == 3)
            .map(|entry| {
                let digest = if entry.digest.is_empty() {
                    None
                } else {
                    Some(
                        hex::decode(&entry.digest)?
                            .try_into()
                            .map_err(|_| anyhow!("digest is not 48 bytes"))?,
                    )
                };
                Ok(Rtmr3Event {
                    event_type: entry.event_type,
                    event: entry.event.clone(),
                    payload: hex::decode(&entry.event_payload)?,
                    digest,
                })
            })
            .collect()
    }

    pub fn address(&self) -> Result<[u8; 20]> {
        verdict_core::inference::decode_address(&self.signing_address)
            .context("signing_address is not 20 bytes")
    }
}

/// Fetches the attestation for `model`, bound to `nonce`. Without TLS
/// binding, which is the `report_data` layout the contract checks.
pub async fn fetch(
    http: &reqwest::Client,
    model: &str,
    nonce: &[u8; 32],
) -> Result<Vec<ModelAttestation>> {
    let response = http
        .get(format!("{NEAR_AI}/v1/attestation/report"))
        .query(&[
            ("model", model),
            ("provider", "near"),
            ("signing_algo", "ecdsa"),
            ("nonce", &hex::encode(nonce)),
        ])
        .send()
        .await?
        .error_for_status()?;
    let report: Value = response.json().await?;
    let candidates = report["model_attestations"]
        .as_array()
        .filter(|candidates| !candidates.is_empty())
        .context("NEAR AI returned no model attestations for this model")?;
    candidates.iter().map(ModelAttestation::from_json).collect()
}

pub struct Checked {
    pub status: String,
    pub report: TdReport,
    pub collateral: dcap_qvl::QuoteCollateralV3,
}

/// Verifies the Intel quote with dcap-qvl, the library `tee-verifier` runs.
pub async fn verify_quote(attestation: &ModelAttestation) -> Result<Checked> {
    let collateral = dcap_qvl::collateral::CollateralClient::with_default_http(
        dcap_qvl::collateral::PHALA_PCCS_URL,
    )?
    .fetch(&attestation.intel_quote)
    .await
    .context("cannot fetch Intel collateral")?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)?
        .as_secs();
    let verified = dcap_qvl::verify::verify(&attestation.intel_quote, &collateral, now)
        .map_err(|error| anyhow!("Intel quote rejected: {error}"))?;
    let td = verified
        .report
        .as_td10()
        .context("quote is not from a TDX VM")?;
    Ok(Checked {
        status: verified.status.clone(),
        report: TdReport {
            td_attributes: td.td_attributes,
            mr_td: td.mr_td,
            mr_config_id: td.mr_config_id,
            rt_mr0: td.rt_mr0,
            rt_mr1: td.rt_mr1,
            rt_mr2: td.rt_mr2,
            rt_mr3: td.rt_mr3,
            report_data: td.report_data,
        },
        collateral,
    })
}

/// The binding rules, against `policy`.
pub fn check_binding(
    attestation: &ModelAttestation,
    checked: &Checked,
    nonce: &[u8; 32],
    policy: &ModelPolicy,
) -> Result<()> {
    if attestation.signing_algo != "ecdsa" {
        bail!(
            "expected an ecdsa signing key, got {}",
            attestation.signing_algo
        );
    }
    let events = attestation.rtmr3_events()?;
    let evidence = ModelEvidence {
        signing_address: attestation.address()?,
        app_compose: &attestation.app_compose,
        rtmr3_events: &events,
    };
    verify_model_evidence(&checked.report, &evidence, nonce, policy)
        .map(|_| ())
        .map_err(|error| anyhow!("{error}"))
}

/// The deployment this attestation was served from.
pub fn deployment_of(attestation: &ModelAttestation, checked: &Checked) -> Deployment {
    Deployment {
        image: ImageMeasurements {
            mr_td: checked.report.mr_td,
            rt_mr0: checked.report.rt_mr0,
            rt_mr1: checked.report.rt_mr1,
            rt_mr2: checked.report.rt_mr2,
        },
        compose_hash: verdict_core::inference::sha256(attestation.app_compose.as_bytes()),
    }
}

/// `set_model_policy` arguments.
pub fn policy_json(model: &str, policy: &ModelPolicy) -> Value {
    let deployments: Vec<Value> = policy
        .deployments
        .iter()
        .map(|deployment| {
            json!({
                "image": {
                    "mr_td": hex::encode(deployment.image.mr_td),
                    "rt_mr0": hex::encode(deployment.image.rt_mr0),
                    "rt_mr1": hex::encode(deployment.image.rt_mr1),
                    "rt_mr2": hex::encode(deployment.image.rt_mr2),
                },
                "compose_hash": hex::encode(deployment.compose_hash),
            })
        })
        .collect();
    json!({ "model": model, "policy": { "deployments": deployments } })
}

/// Parses a `PolicyView` returned by the contract's `get_policy`.
pub fn policy_from_json(value: &Value) -> Result<ModelPolicy> {
    fn bytes<const N: usize>(field: &Value) -> Result<[u8; N]> {
        hex::decode(field.as_str().context("expected a hex string")?)?
            .try_into()
            .map_err(|_| anyhow!("expected {N} bytes"))
    }
    let deployments = value["deployments"]
        .as_array()
        .context("policy has no deployments")?
        .iter()
        .map(|deployment| {
            let image = &deployment["image"];
            Ok(Deployment {
                image: ImageMeasurements {
                    mr_td: bytes(&image["mr_td"])?,
                    rt_mr0: bytes(&image["rt_mr0"])?,
                    rt_mr1: bytes(&image["rt_mr1"])?,
                    rt_mr2: bytes(&image["rt_mr2"])?,
                },
                compose_hash: bytes(&deployment["compose_hash"])?,
            })
        })
        .collect::<Result<_>>()?;
    Ok(ModelPolicy { deployments })
}

/// `register_model` arguments.
pub fn evidence_json(
    attestation: &ModelAttestation,
    checked: &Checked,
    nonce: &[u8; 32],
) -> Result<Value> {
    Ok(json!({
        "evidence": {
            "nonce": hex::encode(nonce),
            "signing_address": attestation.signing_address,
            "intel_quote": hex::encode(&attestation.intel_quote),
            "app_compose": attestation.app_compose,
            "event_log": attestation.event_log.iter().filter(|e| e.imr == 3).map(|e| json!({
                "imr": e.imr,
                "event_type": e.event_type,
                "event": e.event,
                "event_payload": e.event_payload,
                "digest": e.digest,
            })).collect::<Vec<_>>(),
            "collateral": serde_json::to_value(&checked.collateral)?,
        }
    }))
}
