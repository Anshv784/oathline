//! NEP-297 events, so indexers and the app can follow the contract.

use near_sdk::env;
use near_sdk::serde_json::{json, Value};

use crate::registry::RegisteredModel;
use crate::requests::{Request, Status};
use crate::Runner;

fn emit(event: &str, data: Value) {
    let payload = json!({
        "standard": "verdict",
        "version": "1.0.0",
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{payload}"));
}

pub fn policy_set(model: &str) {
    emit("policy_set", json!({ "model": model }));
}

pub fn runner_updated(runner: &Runner) {
    emit(
        "runner_updated",
        json!({ "url": runner.url, "sha256": runner.sha256 }),
    );
}

pub fn challenge_issued(model: &str, nonce: &str, expires_at_ms: u64) {
    emit(
        "challenge_issued",
        json!({ "model": model, "nonce": nonce, "expires_at_ms": expires_at_ms.to_string() }),
    );
}

pub fn model_registered(model: &str, registered: &RegisteredModel) {
    emit(
        "model_registered",
        json!({
            "model": model,
            "signing_address": format!("0x{}", hex::encode(registered.signing_address)),
            "compose_hash": hex::encode(registered.compose_hash),
            "tcb_status": registered.tcb_status,
            "expires_at_ms": registered.expires_at_ms.to_string(),
        }),
    );
}

pub fn registration_rejected(model: &str, reason: &str) {
    emit(
        "registration_rejected",
        json!({ "model": model, "reason": reason }),
    );
}

pub fn model_revoked(model: &str) {
    emit("model_revoked", json!({ "model": model }));
}

pub fn asked(id: u64, request: &Request) {
    emit(
        "asked",
        json!({
            "request_id": id.to_string(),
            "requester": request.requester,
            "model": request.model,
            "request_hash": hex::encode(request.request_hash),
        }),
    );
}

pub fn settled(id: u64, request: &Request) {
    let data = match &request.status {
        Status::Answered {
            answer, response, ..
        } => json!({
            "request_id": id.to_string(),
            "status": "answered",
            "answer": answer,
            "response_hash": hex::encode(env::sha256_array(response)),
        }),
        Status::Failed { reason } => json!({
            "request_id": id.to_string(),
            "status": "failed",
            "reason": reason,
        }),
        Status::Pending => return,
    };
    emit("settled", data);
}
