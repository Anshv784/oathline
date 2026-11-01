//! Binding a verified TDX quote to a NEAR AI model signing key.
//!
//! NEAR AI Cloud serves each model from a dstack confidential VM. When asked
//! for an attestation with a client nonce, it returns an Intel TDX quote whose
//! `report_data` commits to the model's response-signing key and that nonce,
//! together with the VM's app configuration (`app_compose`) and the event log
//! that was extended into RTMR3 while the VM booted.
//!
//! Once `tee-verifier` has checked the quote's Intel signature chain, the
//! rules below decide whether the quote is evidence *for this key, this
//! nonce and an allowed model image*. They follow NEAR AI's published
//! verification procedure (Quote, Nonce, and Signer Bindings):
//! <https://docs.near.ai/cloud/verification/reference/quote-nonce-signer>

use alloc::string::String;
use alloc::vec::Vec;
use core::fmt;
use sha2::{Digest, Sha256, Sha384};

use crate::Address;

/// A 48-byte TDX measurement register value.
pub type Measurement = [u8; 48];

/// The fields of a verified TD report that the binding rules read.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TdReport {
    pub td_attributes: [u8; 8],
    pub mr_td: Measurement,
    pub mr_config_id: Measurement,
    pub rt_mr0: Measurement,
    pub rt_mr1: Measurement,
    pub rt_mr2: Measurement,
    pub rt_mr3: Measurement,
    pub report_data: [u8; 64],
}

/// One entry of the dstack event log that was extended into RTMR3.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Rtmr3Event {
    pub event_type: u32,
    pub event: String,
    pub payload: Vec<u8>,
    /// The digest the log claims for this event. Some reports leave it empty,
    /// in which case only the recomputed digest is used.
    pub digest: Option<Measurement>,
}

/// The registers that identify the VM image: firmware (MRTD), and the
/// kernel, command line and initrd (RTMR0-2). RTMR3 is runtime state and is
/// checked by replaying the event log instead.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ImageMeasurements {
    pub mr_td: Measurement,
    pub rt_mr0: Measurement,
    pub rt_mr1: Measurement,
    pub rt_mr2: Measurement,
}

/// What a model must look like to be accepted.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ModelPolicy {
    /// Allowed VM images. The quote must match one of them exactly.
    pub images: Vec<ImageMeasurements>,
    /// Allowed SHA-256 hashes of the app configuration, i.e. the exact
    /// container set (and model weights) the VM is allowed to run.
    pub compose_hashes: Vec<[u8; 32]>,
}

/// The parts of a NEAR AI model attestation that come from outside the quote.
#[derive(Clone, Copy, Debug)]
pub struct ModelEvidence<'a> {
    pub signing_address: Address,
    pub app_compose: &'a str,
    pub rtmr3_events: &'a [Rtmr3Event],
}

/// A model key that passed every rule.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AttestedModel {
    pub signing_address: Address,
    pub compose_hash: [u8; 32],
    pub image: ImageMeasurements,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AttestationError {
    /// TD_ATTRIBUTES.DEBUG is set: the host can read the VM's memory.
    DebugEnclave,
    /// `report_data` does not commit to this signing key and nonce.
    ReportDataMismatch,
    /// MRCONFIGID does not commit to the supplied `app_compose`.
    ConfigIdMismatch,
    /// An event's claimed digest differs from its recomputed digest.
    EventDigestMismatch { index: usize },
    /// Replaying the event log does not reproduce the quote's RTMR3.
    Rtmr3Mismatch,
    /// The event log has no well-formed `compose-hash` event.
    MissingComposeHash,
    /// The `compose-hash` event disagrees with SHA-256(`app_compose`).
    ComposeHashMismatch,
    /// MRTD/RTMR0-2 match no allowed image.
    ImageNotAllowed,
    /// The app configuration is not one the policy allows.
    ComposeNotAllowed,
}

impl fmt::Display for AttestationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::DebugEnclave => f.write_str("enclave runs in debug mode"),
            Self::ReportDataMismatch => {
                f.write_str("report_data does not bind the signing key and nonce")
            }
            Self::ConfigIdMismatch => f.write_str("MRCONFIGID does not match app_compose"),
            Self::EventDigestMismatch { index } => {
                write!(f, "RTMR3 event {index} has a wrong digest")
            }
            Self::Rtmr3Mismatch => f.write_str("event log does not replay to the quoted RTMR3"),
            Self::MissingComposeHash => f.write_str("event log has no compose-hash event"),
            Self::ComposeHashMismatch => {
                f.write_str("compose-hash event does not match app_compose")
            }
            Self::ImageNotAllowed => f.write_str("VM image is not allowed by the model policy"),
            Self::ComposeNotAllowed => {
                f.write_str("app configuration is not allowed by the model policy")
            }
        }
    }
}

/// `report_data` for a NEAR-operated report requested without TLS binding:
/// the signing identity zero-padded to 32 bytes, then the 32-byte nonce.
pub fn expected_report_data(signing_address: &Address, nonce: &[u8; 32]) -> [u8; 64] {
    let mut out = [0u8; 64];
    out[..20].copy_from_slice(signing_address);
    out[32..].copy_from_slice(nonce);
    out
}

/// MRCONFIGID as dstack sets it: `0x01 || SHA-256(app_compose) || 15 zero bytes`.
pub fn expected_mr_config_id(app_compose: &str) -> Measurement {
    let mut out = [0u8; 48];
    out[0] = 0x01;
    out[1..33].copy_from_slice(&Sha256::digest(app_compose.as_bytes()));
    out
}

/// The digest dstack extends into RTMR3 for one event:
/// `SHA-384(event_type as u32 LE || ":" || event || ":" || payload)`.
pub fn event_digest(event: &Rtmr3Event) -> Measurement {
    let mut hasher = Sha384::new();
    hasher.update(event.event_type.to_le_bytes());
    hasher.update(b":");
    hasher.update(event.event.as_bytes());
    hasher.update(b":");
    hasher.update(&event.payload);
    hasher.finalize().into()
}

/// Replays the event log from 48 zero bytes, checking every claimed digest.
pub fn replay_rtmr3(events: &[Rtmr3Event]) -> Result<Measurement, AttestationError> {
    let mut register = [0u8; 48];
    for (index, event) in events.iter().enumerate() {
        let digest = event_digest(event);
        if event.digest.is_some_and(|claimed| claimed != digest) {
            return Err(AttestationError::EventDigestMismatch { index });
        }
        let mut hasher = Sha384::new();
        hasher.update(register);
        hasher.update(digest);
        register = hasher.finalize().into();
    }
    Ok(register)
}

/// The app configuration hash recorded in the event log.
pub fn compose_hash_event(events: &[Rtmr3Event]) -> Option<[u8; 32]> {
    events
        .iter()
        .find(|event| event.event == "compose-hash")
        .and_then(|event| event.payload.as_slice().try_into().ok())
}

/// Applies every binding rule, in the order NEAR AI documents them.
///
/// `report` must come from a quote whose signature chain has already been
/// verified; this function does not look at the quote bytes.
pub fn verify_model_evidence(
    report: &TdReport,
    evidence: &ModelEvidence<'_>,
    nonce: &[u8; 32],
    policy: &ModelPolicy,
) -> Result<AttestedModel, AttestationError> {
    if report.td_attributes[0] & 0x01 != 0 {
        return Err(AttestationError::DebugEnclave);
    }
    if report.report_data != expected_report_data(&evidence.signing_address, nonce) {
        return Err(AttestationError::ReportDataMismatch);
    }
    if report.mr_config_id != expected_mr_config_id(evidence.app_compose) {
        return Err(AttestationError::ConfigIdMismatch);
    }
    if replay_rtmr3(evidence.rtmr3_events)? != report.rt_mr3 {
        return Err(AttestationError::Rtmr3Mismatch);
    }

    let compose_hash =
        compose_hash_event(evidence.rtmr3_events).ok_or(AttestationError::MissingComposeHash)?;
    let config_hash: [u8; 32] = Sha256::digest(evidence.app_compose.as_bytes()).into();
    if compose_hash != config_hash {
        return Err(AttestationError::ComposeHashMismatch);
    }

    let image = ImageMeasurements {
        mr_td: report.mr_td,
        rt_mr0: report.rt_mr0,
        rt_mr1: report.rt_mr1,
        rt_mr2: report.rt_mr2,
    };
    if !policy.images.contains(&image) {
        return Err(AttestationError::ImageNotAllowed);
    }
    if !policy.compose_hashes.contains(&compose_hash) {
        return Err(AttestationError::ComposeNotAllowed);
    }

    Ok(AttestedModel {
        signing_address: evidence.signing_address,
        compose_hash,
        image,
    })
}
