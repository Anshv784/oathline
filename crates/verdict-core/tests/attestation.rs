mod common;

use verdict_core::attestation::{
    compose_hash_event, verify_model_evidence, AttestationError, ModelEvidence, ModelPolicy,
};

fn evidence(fixture: &common::Fixture) -> ModelEvidence<'_> {
    ModelEvidence {
        signing_address: fixture.signing_address,
        app_compose: &fixture.app_compose,
        rtmr3_events: &fixture.events,
    }
}

#[test]
fn real_near_ai_evidence_is_accepted() {
    let fixture = common::load();
    let policy = common::policy_for(&fixture);

    let model = verify_model_evidence(
        &fixture.report,
        &evidence(&fixture),
        &fixture.nonce,
        &policy,
    )
    .expect("the fixture is genuine NEAR AI evidence");

    assert_eq!(model.signing_address, fixture.signing_address);
    assert_eq!(
        Some(model.compose_hash),
        compose_hash_event(&fixture.events)
    );
}

#[test]
fn evidence_for_another_nonce_is_rejected() {
    let fixture = common::load();
    let mut nonce = fixture.nonce;
    nonce[0] ^= 1;

    let result = verify_model_evidence(
        &fixture.report,
        &evidence(&fixture),
        &nonce,
        &common::policy_for(&fixture),
    );

    assert_eq!(result, Err(AttestationError::ReportDataMismatch));
}

#[test]
fn another_signing_key_is_rejected() {
    let fixture = common::load();
    let mut claimed = evidence(&fixture);
    claimed.signing_address[19] ^= 1;

    let result = verify_model_evidence(
        &fixture.report,
        &claimed,
        &fixture.nonce,
        &common::policy_for(&fixture),
    );

    assert_eq!(result, Err(AttestationError::ReportDataMismatch));
}

#[test]
fn edited_app_compose_is_rejected() {
    let fixture = common::load();
    let edited = format!("{} ", fixture.app_compose);
    let claimed = ModelEvidence {
        app_compose: &edited,
        ..evidence(&fixture)
    };

    let result = verify_model_evidence(
        &fixture.report,
        &claimed,
        &fixture.nonce,
        &common::policy_for(&fixture),
    );

    assert_eq!(result, Err(AttestationError::ConfigIdMismatch));
}

#[test]
fn edited_event_payload_breaks_the_replay() {
    let fixture = common::load();
    let mut events = fixture.events.clone();
    let compose = events
        .iter_mut()
        .find(|event| event.event == "compose-hash")
        .unwrap();
    compose.payload[0] ^= 1;
    let claimed = ModelEvidence {
        rtmr3_events: &events,
        ..evidence(&fixture)
    };

    let result = verify_model_evidence(
        &fixture.report,
        &claimed,
        &fixture.nonce,
        &common::policy_for(&fixture),
    );

    assert_eq!(result, Err(AttestationError::Rtmr3Mismatch));
}

#[test]
fn claimed_digest_that_disagrees_with_the_event_is_rejected() {
    let fixture = common::load();
    let mut events = fixture.events.clone();
    events[1].digest = Some([0xAB; 48]);
    let claimed = ModelEvidence {
        rtmr3_events: &events,
        ..evidence(&fixture)
    };

    let result = verify_model_evidence(
        &fixture.report,
        &claimed,
        &fixture.nonce,
        &common::policy_for(&fixture),
    );

    assert_eq!(
        result,
        Err(AttestationError::EventDigestMismatch { index: 1 })
    );
}

#[test]
fn dropped_event_breaks_the_replay() {
    let fixture = common::load();
    let mut events = fixture.events.clone();
    events.retain(|event| event.event != "instance-id");
    let claimed = ModelEvidence {
        rtmr3_events: &events,
        ..evidence(&fixture)
    };

    let result = verify_model_evidence(
        &fixture.report,
        &claimed,
        &fixture.nonce,
        &common::policy_for(&fixture),
    );

    assert_eq!(result, Err(AttestationError::Rtmr3Mismatch));
}

#[test]
fn debug_enclave_is_rejected() {
    let fixture = common::load();
    let mut report = fixture.report.clone();
    report.td_attributes[0] |= 0x01;

    let result = verify_model_evidence(
        &report,
        &evidence(&fixture),
        &fixture.nonce,
        &common::policy_for(&fixture),
    );

    assert_eq!(result, Err(AttestationError::DebugEnclave));
}

#[test]
fn image_outside_the_policy_is_rejected() {
    let fixture = common::load();
    let mut policy = common::policy_for(&fixture);
    policy.images[0].rt_mr1[0] ^= 1;

    let result = verify_model_evidence(
        &fixture.report,
        &evidence(&fixture),
        &fixture.nonce,
        &policy,
    );

    assert_eq!(result, Err(AttestationError::ImageNotAllowed));
}

#[test]
fn app_configuration_outside_the_policy_is_rejected() {
    let fixture = common::load();
    let policy = ModelPolicy {
        compose_hashes: vec![[7; 32]],
        ..common::policy_for(&fixture)
    };

    let result = verify_model_evidence(
        &fixture.report,
        &evidence(&fixture),
        &fixture.nonce,
        &policy,
    );

    assert_eq!(result, Err(AttestationError::ComposeNotAllowed));
}
