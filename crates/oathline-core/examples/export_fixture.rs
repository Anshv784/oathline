//! Writes a request, response and signature produced by this crate's own
//! code, signed by a fixed *test* key (not a NEAR AI key). The web app's
//! tests check that its independent re-implementation agrees byte for byte.
//!
//!     cargo run -p oathline-core --example export_fixture > app/src/lib/fixtures/signed.json

use k256::ecdsa::{RecoveryId, Signature, SigningKey};
use oathline_core::inference::{sha256, signature_text, InferenceRequest};
use serde_json::json;
use sha3::{Digest, Keccak256};

fn main() {
    let key = SigningKey::from_slice(&[0x42; 32]).unwrap();
    let point = key.verifying_key().to_encoded_point(false);
    let address: [u8; 20] = Keccak256::digest(&point.as_bytes()[1..])[12..]
        .try_into()
        .unwrap();

    let model = "Qwen/Qwen3.8-27B";
    let instructions =
        "Fund open-source developer tooling for NEAR.\nNo token launches, no closed-source work.";
    let submission = "Title: near-lint\n\nAn MIT-licensed linter for near-sdk contracts that flags unchecked promise results — “safety first”.";
    let options = vec!["APPROVE".to_owned(), "REJECT".to_owned()];
    let tag = "verdict.testnet#0:5f3a9c0d1e2b4a67";
    let body = InferenceRequest {
        model,
        instructions,
        submission,
        options: &options,
        tag,
        max_tokens: 400,
    }
    .body();
    let request_hash = sha256(body.as_bytes());

    let response = json!({
        "id": "chatcmpl-fixture",
        "object": "chat.completion",
        "model": model,
        "choices": [{
            "index": 0,
            "message": {
                "role": "assistant",
                "content": "{\"answer\":\"APPROVE\",\"reason\":\"An open-source developer tool for NEAR contracts, within the charter.\"}"
            },
            "finish_reason": "stop"
        }]
    })
    .to_string();
    let text = signature_text(model, &request_hash, &sha256(response.as_bytes()));
    let mut message = format!("\x19Ethereum Signed Message:\n{}", text.len()).into_bytes();
    message.extend_from_slice(text.as_bytes());
    let digest: [u8; 32] = Keccak256::digest(&message).into();
    let (signature, id): (Signature, RecoveryId) = key.sign_prehash_recoverable(&digest).unwrap();
    let mut signature = signature.to_bytes().to_vec();
    signature.push(27 + id.to_byte());

    let fixture = json!({
        "note": "Signed by a fixed test key, not a NEAR AI enclave key. For tests and offline preview only.",
        "model": model,
        "instructions": instructions,
        "submission": submission,
        "options": options,
        "tag": tag,
        "body": body,
        "request_hash": hex::encode(request_hash),
        "response": response,
        "signer": format!("0x{}", hex::encode(address)),
        "signature": {
            "text": text,
            "signature": format!("0x{}", hex::encode(signature)),
            "signing_address": format!("0x{}", hex::encode(address)),
            "signing_algo": "ecdsa",
            "signature_kind": "provider_tee"
        }
    });
    println!("{}", serde_json::to_string_pretty(&fixture).unwrap());
}
