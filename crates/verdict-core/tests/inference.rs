//! Signs responses with a local key exactly the way a NEAR AI model enclave
//! does (EIP-191 over `<model>:<sha256(request)>:<sha256(response)>`) and
//! checks that only the untouched pair is accepted.

use k256::ecdsa::{RecoveryId, Signature, SigningKey, VerifyingKey};
use sha3::{Digest, Keccak256};
use verdict_core::inference::{
    personal_sign_digest, sha256, signature_text, verify_response, InferenceError,
    InferenceRequest, SignedResponse,
};
use verdict_core::{Address, Crypto};

struct TestCrypto;

impl Crypto for TestCrypto {
    fn keccak256(&self, data: &[u8]) -> [u8; 32] {
        Keccak256::digest(data).into()
    }

    fn ecrecover(&self, digest: &[u8; 32], signature: &[u8; 64], v: u8) -> Option<[u8; 64]> {
        let signature = Signature::from_slice(signature).ok()?;
        let id = RecoveryId::from_byte(v)?;
        let key = VerifyingKey::recover_from_prehash(digest, &signature, id).ok()?;
        key.to_encoded_point(false).as_bytes()[1..].try_into().ok()
    }
}

const MODEL: &str = "Qwen/Qwen3.8-27B";

fn options() -> Vec<String> {
    vec!["APPROVE".into(), "REJECT".into()]
}

fn address_of(key: &SigningKey) -> Address {
    let point = key.verifying_key().to_encoded_point(false);
    Keccak256::digest(&point.as_bytes()[1..])[12..]
        .try_into()
        .unwrap()
}

fn request_body(options: &[String]) -> String {
    InferenceRequest {
        model: MODEL,
        instructions: "Fund only open-source tooling for NEAR developers.",
        submission: "Build a NEAR contract linter, MIT licensed.",
        options,
        tag: "verdict.testnet#7:9f2c",
        max_tokens: 200,
    }
    .body()
}

fn completion(model: &str, content: &str, finish_reason: &str) -> Vec<u8> {
    serde_json::json!({
        "id": "chatcmpl-0b1c",
        "object": "chat.completion",
        "model": model,
        "choices": [{
            "index": 0,
            "message": { "role": "assistant", "content": content },
            "finish_reason": finish_reason
        }]
    })
    .to_string()
    .into_bytes()
}

fn sign(key: &SigningKey, text: &str) -> SignedResponse {
    let digest = personal_sign_digest(&TestCrypto, text);
    let (signature, id): (Signature, RecoveryId) = key.sign_prehash_recoverable(&digest).unwrap();
    let mut bytes = signature.to_bytes().to_vec();
    bytes.push(27 + id.to_byte());
    SignedResponse {
        text: text.to_owned(),
        signature: format!("0x{}", hex::encode(bytes)),
        signing_address: format!("0x{}", hex::encode(address_of(key))),
        signing_algo: "ecdsa".into(),
        signature_kind: Some("provider_tee".into()),
    }
}

struct Case {
    key: SigningKey,
    request_hash: [u8; 32],
    response: Vec<u8>,
    signed: SignedResponse,
}

fn signed_case(content: &str) -> Case {
    let key = SigningKey::from_slice(&[0x42; 32]).unwrap();
    let request_hash = sha256(request_body(&options()).as_bytes());
    let response = completion(MODEL, content, "stop");
    let text = signature_text(MODEL, &request_hash, &sha256(&response));
    let signed = sign(&key, &text);
    Case {
        key,
        request_hash,
        response,
        signed,
    }
}

fn check(case: &Case) -> Result<verdict_core::inference::Verdict, InferenceError> {
    verify_response(
        &TestCrypto,
        MODEL,
        &case.request_hash,
        &case.response,
        &case.signed,
        &address_of(&case.key),
        &options(),
    )
}

#[test]
fn request_body_is_deterministic_and_tagged() {
    let first = request_body(&options());
    assert_eq!(first, request_body(&options()));
    assert!(first.contains("verdict.testnet#7:9f2c"));
    let parsed: serde_json::Value = serde_json::from_str(&first).unwrap();
    assert_eq!(parsed["temperature"], 0);
    assert_eq!(
        parsed["response_format"]["json_schema"]["schema"]["properties"]["answer"]["enum"],
        serde_json::json!(["APPROVE", "REJECT"])
    );
}

#[test]
fn signed_answer_is_accepted() {
    let case = signed_case(r#"{"answer":"APPROVE","reason":"Open-source developer tooling."}"#);

    let verdict = check(&case).unwrap();

    assert_eq!(verdict.answer, "APPROVE");
    assert_eq!(verdict.reason, "Open-source developer tooling.");
    assert_eq!(verdict.completion_id, "chatcmpl-0b1c");
    assert_eq!(verdict.response_hash, sha256(&case.response));
}

#[test]
fn edited_response_is_rejected() {
    let mut case = signed_case(r#"{"answer":"REJECT","reason":"Not tooling."}"#);
    case.response = completion(
        MODEL,
        r#"{"answer":"APPROVE","reason":"Not tooling."}"#,
        "stop",
    );

    assert_eq!(check(&case), Err(InferenceError::SignedTextMismatch));
}

#[test]
fn signature_for_another_request_is_rejected() {
    let mut case = signed_case(r#"{"answer":"APPROVE","reason":"ok"}"#);
    case.request_hash = sha256(b"a different request");

    assert_eq!(check(&case), Err(InferenceError::SignedTextMismatch));
}

#[test]
fn key_other_than_the_registered_one_is_rejected() {
    let case = signed_case(r#"{"answer":"APPROVE","reason":"ok"}"#);
    let impostor = SigningKey::from_slice(&[0x07; 32]).unwrap();
    let forged = Case {
        signed: sign(&impostor, &case.signed.text),
        ..case
    };

    assert_eq!(check(&forged), Err(InferenceError::WrongSigner));
}

#[test]
fn gateway_signature_is_rejected() {
    let mut case = signed_case(r#"{"answer":"APPROVE","reason":"ok"}"#);
    case.signed.signature_kind = Some("gateway".into());

    assert_eq!(check(&case), Err(InferenceError::NotModelSigned));
}

#[test]
fn flipped_signature_byte_is_rejected() {
    let mut case = signed_case(r#"{"answer":"APPROVE","reason":"ok"}"#);
    let mut bytes = hex::decode(case.signed.signature.trim_start_matches("0x")).unwrap();
    bytes[10] ^= 1;
    case.signed.signature = hex::encode(bytes);

    assert!(matches!(
        check(&case),
        Err(InferenceError::WrongSigner | InferenceError::MalformedSignature)
    ));
}

#[test]
fn answer_outside_the_options_is_rejected() {
    let case = signed_case(r#"{"answer":"MAYBE","reason":"unsure"}"#);

    assert_eq!(check(&case), Err(InferenceError::AnswerNotAllowed));
}

#[test]
fn prose_instead_of_json_is_rejected() {
    let case = signed_case("APPROVE, because it is tooling.");

    assert_eq!(check(&case), Err(InferenceError::MalformedResponse));
}

#[test]
fn truncated_answer_is_rejected() {
    let key = SigningKey::from_slice(&[0x42; 32]).unwrap();
    let request_hash = sha256(request_body(&options()).as_bytes());
    let response = completion(MODEL, r#"{"answer":"APPROVE","reason":"ok"}"#, "length");
    let signed = sign(
        &key,
        &signature_text(MODEL, &request_hash, &sha256(&response)),
    );

    let case = Case {
        key,
        request_hash,
        response,
        signed,
    };

    assert_eq!(check(&case), Err(InferenceError::Truncated));
}

#[test]
fn response_from_another_model_is_rejected() {
    let key = SigningKey::from_slice(&[0x42; 32]).unwrap();
    let request_hash = sha256(request_body(&options()).as_bytes());
    let response = completion(
        "deepseek-ai/DeepSeek-V4.1-Flash-1017",
        r#"{"answer":"APPROVE","reason":"ok"}"#,
        "stop",
    );
    let signed = sign(
        &key,
        &signature_text(MODEL, &request_hash, &sha256(&response)),
    );

    let case = Case {
        key,
        request_hash,
        response,
        signed,
    };

    assert_eq!(check(&case), Err(InferenceError::ModelMismatch));
}
