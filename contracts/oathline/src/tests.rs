//! Unit tests. Registration is driven by a real NEAR AI attestation (the
//! `tee-verifier` result is built from the fixture quote's own TD report);
//! answers are signed by a local key in NEAR AI's exact signature format.

use base64::Engine;
use k256::ecdsa::{RecoveryId, Signature, SigningKey};
use near_sdk::json_types::U64;
use near_sdk::serde_json::{self, json, Value};
use near_sdk::test_utils::{accounts, get_logs, VMContextBuilder};
use near_sdk::{testing_env, AccountId, NearToken, PromiseError, PromiseResult};
use oathline_core::inference::{sha256, signature_text, SignedResponse};
use sha3::{Digest, Keccak256};
use tee_verifier_interface::{
    Report, TDReport10, TcbStatus, TcbStatusWithAdvisory, VerificationResult, VerifiedReport,
    VerifierError,
};

use crate::registry::{Challenge, PendingRegistration, RegisteredModel, StoredEvent, StoredImage};
use crate::views::{DeploymentView, ImageView, Outcome, PolicyView, RegistrationOutcome};
use crate::{Oathline, Runner, Secrets, Status};

const MODEL: &str = "Qwen/Qwen3.8-27B";
const REPORT: &str =
    include_str!("../../../crates/oathline-core/tests/fixtures/qwen3.8-27b.report.json");
const NONCE: &str = include_str!("../../../crates/oathline-core/tests/fixtures/qwen3.8-27b.nonce");

fn owner() -> AccountId {
    accounts(0)
}

fn context(predecessor: AccountId) -> VMContextBuilder {
    let mut builder = VMContextBuilder::new();
    builder
        .current_account_id("verdict.testnet".parse().unwrap())
        .predecessor_account_id(predecessor.clone())
        .signer_account_id(predecessor)
        .account_balance(NearToken::from_near(50))
        .prepaid_gas(near_sdk::Gas::from_tgas(300))
        .block_timestamp(1_790_000_000_000_000_000);
    builder
}

fn contract() -> Oathline {
    testing_env!(context(owner()).build());
    Oathline::new(
        owner(),
        "tee-verifier.testnet".parse().unwrap(),
        "outlayer.testnet".parse().unwrap(),
        Runner {
            url: "https://example.org/runner.wasm".into(),
            sha256: "ab".repeat(32),
        },
        Secrets {
            profile: "default".into(),
            account_id: owner(),
        },
    )
}

// ---- fixture ---------------------------------------------------------------

struct Fixture {
    model: Value,
    td: TDReport10,
    nonce: [u8; 32],
}

fn fixture() -> Fixture {
    let root: Value = serde_json::from_str(REPORT).unwrap();
    let model = root["model_attestations"][0].clone();
    let quote = hex::decode(model["intel_quote"].as_str().unwrap()).unwrap();
    let body = |start: usize, len: usize| quote[48 + start..48 + start + len].to_vec();
    let m48 = |start: usize| -> [u8; 48] { body(start, 48).try_into().unwrap() };
    let td = TDReport10 {
        tee_tcb_svn: body(0, 16).try_into().unwrap(),
        mr_seam: m48(16),
        mr_signer_seam: m48(64),
        seam_attributes: body(112, 8).try_into().unwrap(),
        td_attributes: body(120, 8).try_into().unwrap(),
        xfam: body(128, 8).try_into().unwrap(),
        mr_td: m48(136),
        mr_config_id: m48(184),
        mr_owner: m48(232),
        mr_owner_config: m48(280),
        rt_mr0: m48(328),
        rt_mr1: m48(376),
        rt_mr2: m48(424),
        rt_mr3: m48(472),
        report_data: body(520, 64).try_into().unwrap(),
    };
    let nonce = hex::decode(NONCE.trim()).unwrap().try_into().unwrap();
    Fixture { model, td, nonce }
}

fn fixture_policy(fixture: &Fixture) -> PolicyView {
    PolicyView {
        deployments: vec![DeploymentView {
            image: ImageView {
                mr_td: hex::encode(fixture.td.mr_td),
                rt_mr0: hex::encode(fixture.td.rt_mr0),
                rt_mr1: hex::encode(fixture.td.rt_mr1),
                rt_mr2: hex::encode(fixture.td.rt_mr2),
            },
            compose_hash: fixture.model["info"]["compose_hash"]
                .as_str()
                .unwrap()
                .to_owned(),
        }],
    }
}

fn pending(fixture: &Fixture) -> PendingRegistration {
    let log = fixture.model["event_log"].as_array().unwrap();
    let events = log
        .iter()
        .filter(|event| event["imr"] == 3)
        .map(|event| StoredEvent {
            event_type: event["event_type"].as_u64().unwrap() as u32,
            event: event["event"].as_str().unwrap().to_owned(),
            payload: hex::decode(event["event_payload"].as_str().unwrap()).unwrap(),
            digest: None,
        })
        .collect();
    let address = hex::decode(
        fixture.model["signing_address"]
            .as_str()
            .unwrap()
            .trim_start_matches("0x"),
    );
    PendingRegistration {
        model: MODEL.into(),
        nonce: fixture.nonce,
        signing_address: address.unwrap().try_into().unwrap(),
        app_compose: fixture.model["info"]["tcb_info"]["app_compose"]
            .as_str()
            .unwrap()
            .to_owned(),
        events,
        requester: accounts(1),
        deposit: NearToken::from_millinear(20),
        submitted_by: accounts(1),
    }
}

fn verified(td: TDReport10, status: &str) -> Result<VerificationResult, PromiseError> {
    Ok(VerificationResult::Verified(VerifiedReport {
        status: status.into(),
        advisory_ids: vec![],
        report: Report::TD10(td),
        ppid: vec![],
        qe_status: TcbStatusWithAdvisory {
            status: TcbStatus::UpToDate,
            advisory_ids: vec![],
        },
        platform_status: TcbStatusWithAdvisory {
            status: TcbStatus::UpToDate,
            advisory_ids: vec![],
        },
    }))
}

fn rejected_reason(outcome: RegistrationOutcome) -> String {
    match outcome {
        RegistrationOutcome::Rejected { reason } => reason,
        other => panic!("expected a rejection, got {other:?}"),
    }
}

// ---- registration -----------------------------------------------------------

#[test]
fn real_attestation_registers_the_model() {
    let mut oathline = contract();
    let fixture = fixture();
    oathline.set_model_policy(MODEL.into(), fixture_policy(&fixture));

    let outcome =
        oathline.on_quote_verified(pending(&fixture), verified(fixture.td.clone(), "UpToDate"));

    let RegistrationOutcome::Registered { model } = outcome else {
        panic!("{outcome:?}")
    };
    assert_eq!(
        model.signing_address,
        fixture.model["signing_address"].as_str().unwrap()
    );
    assert_eq!(
        model.compose_hash,
        fixture.model["info"]["compose_hash"].as_str().unwrap()
    );
    assert!(get_logs()
        .iter()
        .any(|log| log.contains("\"event\":\"model_registered\"")));
}

#[test]
fn start_registration_issues_a_single_use_nonce() {
    let mut oathline = contract();
    oathline.set_model_policy(MODEL.into(), fixture_policy(&fixture()));
    testing_env!(context(accounts(1))
        .attached_deposit(NearToken::from_millinear(20))
        .build());

    let first = oathline.start_registration(MODEL.into());
    let second = oathline.start_registration(MODEL.into());

    assert_ne!(first, second);
    assert!(oathline.get_challenge_expiry(first).is_some());
}

#[test]
#[should_panic(expected = "no policy for this model")]
fn models_without_a_policy_cannot_be_registered() {
    let mut oathline = contract();
    testing_env!(context(accounts(1))
        .attached_deposit(NearToken::from_millinear(20))
        .build());
    oathline.start_registration("some/other-model".into());
}

#[test]
fn evidence_for_another_nonce_is_rejected() {
    let mut oathline = contract();
    let fixture = fixture();
    oathline.set_model_policy(MODEL.into(), fixture_policy(&fixture));
    let mut registration = pending(&fixture);
    registration.nonce[5] ^= 1;

    let reason =
        rejected_reason(oathline.on_quote_verified(registration, verified(fixture.td, "UpToDate")));

    assert_eq!(
        reason,
        "report_data does not bind the signing key and nonce"
    );
    assert!(oathline.get_model(MODEL.into()).is_none());
}

#[test]
fn out_of_date_platform_is_rejected() {
    let mut oathline = contract();
    let fixture = fixture();
    oathline.set_model_policy(MODEL.into(), fixture_policy(&fixture));

    let reason = rejected_reason(
        oathline.on_quote_verified(pending(&fixture), verified(fixture.td, "OutOfDate")),
    );

    assert_eq!(reason, "TCB status OutOfDate is not accepted");
}

#[test]
fn quote_rejected_by_the_verifier_is_rejected() {
    let mut oathline = contract();
    let fixture = fixture();
    oathline.set_model_policy(MODEL.into(), fixture_policy(&fixture));
    let result = Ok(VerificationResult::Rejected(
        VerifierError::DcapVerification("bad signature".into()),
    ));

    let reason = rejected_reason(oathline.on_quote_verified(pending(&fixture), result));

    assert_eq!(
        reason,
        "Intel quote rejected: dcap verification failed: bad signature"
    );
}

#[test]
fn image_outside_the_policy_is_rejected() {
    let mut oathline = contract();
    let fixture = fixture();
    let mut policy = fixture_policy(&fixture);
    policy.deployments[0].image.mr_td = "00".repeat(48);
    oathline.set_model_policy(MODEL.into(), policy);

    let reason = rejected_reason(
        oathline.on_quote_verified(pending(&fixture), verified(fixture.td, "UpToDate")),
    );

    assert_eq!(reason, "VM image is not allowed by the model policy");
}

#[test]
#[should_panic(expected = "only the owner can do this")]
fn only_the_owner_sets_policies() {
    let mut oathline = contract();
    testing_env!(context(accounts(2)).build());
    oathline.set_model_policy(MODEL.into(), fixture_policy(&fixture()));
}

#[test]
#[should_panic(expected = "unknown or used nonce")]
fn a_nonce_cannot_be_submitted_twice() {
    let mut oathline = contract();
    let fixture = fixture();
    oathline.set_model_policy(MODEL.into(), fixture_policy(&fixture));
    oathline.challenges.insert(
        fixture.nonce,
        Challenge {
            model: MODEL.into(),
            requester: accounts(1),
            deposit: NearToken::from_millinear(20),
            expires_at_ms: u64::MAX,
        },
    );
    let evidence = || crate::views::RegistrationEvidence {
        nonce: hex::encode(fixture.nonce),
        signing_address: fixture.model["signing_address"].as_str().unwrap().into(),
        intel_quote: fixture.model["intel_quote"].as_str().unwrap().into(),
        app_compose: String::new(),
        event_log: vec![],
        collateral: serde_json::from_str(include_str!(
            "../../../crates/oathline-core/tests/fixtures/qwen3.8-27b.collateral.json"
        ))
        .unwrap(),
    };
    let _ = oathline.register_model(evidence());
    let _ = oathline.register_model(evidence());
}

#[test]
fn expired_nonce_deposit_can_be_reclaimed() {
    let mut oathline = contract();
    oathline.set_model_policy(MODEL.into(), fixture_policy(&fixture()));
    testing_env!(context(accounts(1))
        .attached_deposit(NearToken::from_millinear(20))
        .build());
    let nonce = oathline.start_registration(MODEL.into());

    let later = 1_790_000_000_000_000_000 + (crate::registry::CHALLENGE_TTL_MS + 1) * 1_000_000;
    testing_env!(context(accounts(2)).block_timestamp(later).build());
    oathline.reclaim_challenge(nonce.clone());

    assert!(oathline.get_challenge_expiry(nonce).is_none());
}

#[test]
#[should_panic(expected = "nonce has not expired yet")]
fn live_nonce_cannot_be_reclaimed() {
    let mut oathline = contract();
    oathline.set_model_policy(MODEL.into(), fixture_policy(&fixture()));
    testing_env!(context(accounts(1))
        .attached_deposit(NearToken::from_millinear(20))
        .build());
    let nonce = oathline.start_registration(MODEL.into());
    oathline.reclaim_challenge(nonce);
}

// ---- asking and answering ---------------------------------------------------

fn model_key() -> SigningKey {
    SigningKey::from_slice(&[0x42; 32]).unwrap()
}

fn address_of(key: &SigningKey) -> [u8; 20] {
    let point = key.verifying_key().to_encoded_point(false);
    Keccak256::digest(&point.as_bytes()[1..])[12..]
        .try_into()
        .unwrap()
}

fn with_registered_key(oathline: &mut Oathline, key: &SigningKey) {
    let image = StoredImage {
        mr_td: [1; 48],
        rt_mr0: [2; 48],
        rt_mr1: [3; 48],
        rt_mr2: [4; 48],
    };
    oathline.models.insert(
        MODEL.into(),
        RegisteredModel {
            signing_address: address_of(key),
            compose_hash: [5; 32],
            image,
            tcb_status: "UpToDate".into(),
            registered_by: accounts(1),
            registered_at_ms: 0,
            expires_at_ms: u64::MAX,
        },
    );
}

fn ask(oathline: &mut Oathline) -> u64 {
    testing_env!(context(accounts(3))
        .attached_deposit(NearToken::from_millinear(200))
        .build());
    let _ = oathline.ask(
        MODEL.into(),
        "Fund only open-source tooling for NEAR developers.".into(),
        "Build a NEAR contract linter, MIT licensed.".into(),
        vec!["APPROVE".into(), "REJECT".into()],
        Some(true),
    );
    oathline.requests.len() as u64 - 1
}

fn completion(content: &str) -> Vec<u8> {
    json!({
        "id": "chatcmpl-77",
        "model": MODEL,
        "choices": [{ "index": 0, "message": { "role": "assistant", "content": content }, "finish_reason": "stop" }]
    })
    .to_string()
    .into_bytes()
}

fn sign(key: &SigningKey, request_hash: &[u8; 32], response: &[u8]) -> SignedResponse {
    let text = signature_text(MODEL, request_hash, &sha256(response));
    let mut message = format!("\x19Ethereum Signed Message:\n{}", text.len()).into_bytes();
    message.extend_from_slice(text.as_bytes());
    let digest: [u8; 32] = Keccak256::digest(&message).into();
    let (signature, id): (Signature, RecoveryId) = key.sign_prehash_recoverable(&digest).unwrap();
    let mut bytes = signature.to_bytes().to_vec();
    bytes.push(27 + id.to_byte());
    SignedResponse {
        text,
        signature: hex::encode(bytes),
        signing_address: format!("0x{}", hex::encode(address_of(key))),
        signing_algo: "ecdsa".into(),
        signature_kind: Some("provider_tee".into()),
    }
}

fn runner_output(response: &[u8], signature: &SignedResponse) -> Vec<u8> {
    json!({
        "response": base64::engine::general_purpose::STANDARD.encode(response),
        "signature": signature,
    })
    .to_string()
    .into_bytes()
}

fn deliver(oathline: &mut Oathline, id: u64, result: PromiseResult) -> Outcome {
    testing_env!(
        context("verdict.testnet".parse().unwrap()).build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![result],
    );
    oathline.on_inference(U64(id)).outcome
}

#[test]
fn ask_stores_the_exact_request_it_sends() {
    let mut oathline = contract();
    with_registered_key(&mut oathline, &model_key());

    let id = ask(&mut oathline);

    let view = oathline.get_request(U64(id)).unwrap();
    let body = oathline.get_request_body(U64(id)).unwrap();
    assert_eq!(view.outcome, Outcome::Pending);
    assert_eq!(view.request_hash, hex::encode(sha256(body.as_bytes())));
    assert!(body.contains(&view.tag));
}

#[test]
#[should_panic(expected = "model is not registered")]
fn unregistered_models_cannot_be_asked() {
    let mut oathline = contract();
    ask(&mut oathline);
}

#[test]
#[should_panic(expected = "options must be 1-32 characters of A-Z, 0-9 or _")]
fn free_form_options_are_refused() {
    let mut oathline = contract();
    with_registered_key(&mut oathline, &model_key());
    testing_env!(context(accounts(3))
        .attached_deposit(NearToken::from_millinear(200))
        .build());
    let _ = oathline.ask(
        MODEL.into(),
        "rules".into(),
        "text".into(),
        vec!["yes".into(), "no".into()],
        None,
    );
}

#[test]
fn signed_answer_is_accepted_and_kept_for_reverification() {
    let mut oathline = contract();
    let key = model_key();
    with_registered_key(&mut oathline, &key);
    let id = ask(&mut oathline);
    let request_hash = oathline.requests.get(id as u32).unwrap().request_hash;
    let response = completion(r#"{"answer":"APPROVE","reason":"Open-source developer tooling."}"#);

    let outcome = deliver(
        &mut oathline,
        id,
        PromiseResult::Successful(runner_output(
            &response,
            &sign(&key, &request_hash, &response),
        )),
    );

    assert_eq!(
        outcome,
        Outcome::Answered {
            answer: "APPROVE".into(),
            reason: "Open-source developer tooling.".into()
        }
    );
    let view = oathline.get_request(U64(id)).unwrap();
    let stored = base64::engine::general_purpose::STANDARD
        .decode(view.response_base64.unwrap())
        .unwrap();
    assert_eq!(stored, response);
    assert!(get_logs()
        .iter()
        .any(|log| log.contains("\"status\":\"answered\"")));
}

#[test]
fn edited_answer_is_refused() {
    let mut oathline = contract();
    let key = model_key();
    with_registered_key(&mut oathline, &key);
    let id = ask(&mut oathline);
    let request_hash = oathline.requests.get(id as u32).unwrap().request_hash;
    let genuine = completion(r#"{"answer":"REJECT","reason":"Not tooling."}"#);
    let signature = sign(&key, &request_hash, &genuine);
    let edited = completion(r#"{"answer":"APPROVE","reason":"Not tooling."}"#);

    let outcome = deliver(
        &mut oathline,
        id,
        PromiseResult::Successful(runner_output(&edited, &signature)),
    );

    assert_eq!(
        outcome,
        Outcome::Failed {
            reason: "signed text does not match this request and response".into()
        }
    );
}

#[test]
fn answer_signed_by_another_key_is_refused() {
    let mut oathline = contract();
    with_registered_key(&mut oathline, &model_key());
    let id = ask(&mut oathline);
    let request_hash = oathline.requests.get(id as u32).unwrap().request_hash;
    let response = completion(r#"{"answer":"APPROVE","reason":"ok"}"#);
    let impostor = SigningKey::from_slice(&[0x07; 32]).unwrap();

    let outcome = deliver(
        &mut oathline,
        id,
        PromiseResult::Successful(runner_output(
            &response,
            &sign(&impostor, &request_hash, &response),
        )),
    );

    assert_eq!(
        outcome,
        Outcome::Failed {
            reason: "signature does not recover to the registered model key".into()
        }
    );
}

#[test]
fn answers_from_a_revoked_model_are_refused() {
    let mut oathline = contract();
    let key = model_key();
    with_registered_key(&mut oathline, &key);
    let id = ask(&mut oathline);
    let request_hash = oathline.requests.get(id as u32).unwrap().request_hash;
    testing_env!(context(owner()).build());
    oathline.remove_model(MODEL.into());
    let response = completion(r#"{"answer":"APPROVE","reason":"ok"}"#);

    let outcome = deliver(
        &mut oathline,
        id,
        PromiseResult::Successful(runner_output(
            &response,
            &sign(&key, &request_hash, &response),
        )),
    );

    assert_eq!(
        outcome,
        Outcome::Failed {
            reason: "model key was revoked before the answer arrived".into()
        }
    );
}

#[test]
fn runner_errors_are_recorded() {
    let mut oathline = contract();
    with_registered_key(&mut oathline, &model_key());
    let id = ask(&mut oathline);

    let output = json!({ "error": "NEAR AI returned 429" })
        .to_string()
        .into_bytes();
    let outcome = deliver(&mut oathline, id, PromiseResult::Successful(output));

    assert_eq!(
        outcome,
        Outcome::Failed {
            reason: "runner: NEAR AI returned 429".into()
        }
    );
}

#[test]
fn failed_outlayer_call_refunds_the_requester() {
    let mut oathline = contract();
    with_registered_key(&mut oathline, &model_key());
    let id = ask(&mut oathline);

    let outcome = deliver(&mut oathline, id, PromiseResult::Failed);

    assert_eq!(
        outcome,
        Outcome::Failed {
            reason: "OutLayer did not run the request".into()
        }
    );
    let refunds = near_sdk::test_utils::get_created_receipts()
        .into_iter()
        .flat_map(|receipt| receipt.actions)
        .filter(|action| matches!(action, near_sdk::mock::MockAction::Transfer { .. }))
        .count();
    assert_eq!(
        refunds, 1,
        "a rejected call returns the deposit to the requester"
    );
    assert!(matches!(
        oathline.requests.get(id as u32).unwrap().status,
        Status::Failed { .. }
    ));
}

#[test]
fn oversized_runner_output_fails_without_a_refund() {
    let mut oathline = contract();
    with_registered_key(&mut oathline, &model_key());
    let id = ask(&mut oathline);
    let huge = json!({ "error": "x".repeat(20 * 1024) })
        .to_string()
        .into_bytes();

    let outcome = deliver(&mut oathline, id, PromiseResult::Successful(huge));

    assert_eq!(
        outcome,
        Outcome::Failed {
            reason: "runner output is too large".into()
        }
    );
    let refunds = near_sdk::test_utils::get_created_receipts()
        .into_iter()
        .flat_map(|receipt| receipt.actions)
        .filter(|action| matches!(action, near_sdk::mock::MockAction::Transfer { .. }))
        .count();
    assert_eq!(
        refunds, 0,
        "the contract must not refund from its own balance"
    );
}

#[test]
#[should_panic(expected = "request already settled")]
fn a_request_settles_once() {
    let mut oathline = contract();
    with_registered_key(&mut oathline, &model_key());
    let id = ask(&mut oathline);
    deliver(&mut oathline, id, PromiseResult::Failed);
    deliver(&mut oathline, id, PromiseResult::Failed);
}

#[test]
fn check_response_explains_why_an_edit_fails() {
    let mut oathline = contract();
    let key = model_key();
    with_registered_key(&mut oathline, &key);
    let id = ask(&mut oathline);
    let request_hash = oathline.requests.get(id as u32).unwrap().request_hash;
    let response = completion(r#"{"answer":"REJECT","reason":"Not tooling."}"#);
    let signed = sign(&key, &request_hash, &response);
    let signature = crate::views::SignatureView {
        text: signed.text,
        signature: signed.signature,
        signing_address: signed.signing_address,
        signing_algo: signed.signing_algo,
        signature_kind: signed.signature_kind,
    };
    let encode = |bytes: &[u8]| base64::engine::general_purpose::STANDARD.encode(bytes);

    let genuine = oathline.check_response(U64(id), encode(&response), signature.clone());
    let edited = oathline.check_response(
        U64(id),
        encode(&completion(
            r#"{"answer":"APPROVE","reason":"Not tooling."}"#,
        )),
        signature,
    );

    assert!(genuine.accepted);
    assert_eq!(genuine.answer.as_deref(), Some("REJECT"));
    assert!(!edited.accepted);
    assert_eq!(
        edited.error.as_deref(),
        Some("signed text does not match this request and response")
    );
}
