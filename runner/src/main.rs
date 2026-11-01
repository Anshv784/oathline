//! Runs inside an OutLayer TDX worker on behalf of the Verdict contract.
//!
//! stdin:  `{"model": "...", "body": "..."}` where `body` is the exact
//!         request the contract wrote and hashed.
//! stdout: `{"response": "<base64 of the raw response bytes>",
//!           "signature": { ...GET /v1/signature/{id}... }}`
//!         or `{"error": "..."}`.
//!
//! The chat completion is requested exactly once. It is never retried, so
//! whoever operates the worker cannot ask again and keep the answer they
//! prefer; only fetching the signature for that one completion is retried.
//! The runner does no checking of the answer: the contract verifies that.
//! It only refuses to spend the NEAR AI key for any caller other than the
//! Verdict contract named in its secrets.

use std::io::{self, Read, Write};
use std::thread::sleep;
use std::time::Duration;

use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};
use wasi_http_client::Client;

/// Overridable at build time for local tests only. A different URL produces
/// a different WASM hash, which the contract would not run.
const NEAR_AI: &str = match option_env!("VERDICT_NEAR_AI_URL") {
    Some(url) => url,
    None => "https://cloud-api.near.ai",
};
const SIGNATURE_ATTEMPTS: u32 = 6;
const SIGNATURE_BACKOFF: Duration = Duration::from_millis(800);
const TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Deserialize)]
struct Input {
    model: String,
    body: String,
}

fn main() {
    let output = match run() {
        Ok(output) => output,
        Err(error) => json!({ "error": error }),
    };
    print!("{output}");
    io::stdout().flush().ok();
}

fn run() -> Result<Value, String> {
    let mut stdin = String::new();
    io::stdin()
        .read_to_string(&mut stdin)
        .map_err(|e| format!("cannot read input: {e}"))?;
    let input: Input = serde_json::from_str(&stdin).map_err(|e| format!("bad input: {e}"))?;
    let api_key = std::env::var("NEARAI_API_KEY")
        .map_err(|_| "NEARAI_API_KEY is not set in the OutLayer secrets".to_owned())?;
    check_caller()?;
    let auth = format!("Bearer {api_key}");

    let response = Client::new()
        .post(&format!("{NEAR_AI}/v1/chat/completions"))
        .header("Content-Type", "application/json")
        .header("Content-Length", input.body.len().to_string().as_str())
        .header("Authorization", auth.as_str())
        // The signature covers the uncompressed bytes.
        .header("Accept-Encoding", "identity")
        // Keep the model id we sent: it is part of the signed text.
        .header("x-no-aliasing", "true")
        .connect_timeout(TIMEOUT)
        .body(input.body.as_bytes())
        .send()
        .map_err(|e| format!("completion request failed: {e}"))?;
    let status = response.status();
    let bytes = response
        .body()
        .map_err(|e| format!("cannot read completion: {e}"))?;
    if status != 200 {
        return Err(format!("NEAR AI returned {status}: {}", preview(&bytes)));
    }

    let completion_id = serde_json::from_slice::<Value>(&bytes)
        .ok()
        .and_then(|value| value["id"].as_str().map(str::to_owned))
        .ok_or("completion has no id")?;
    let signature = fetch_signature(&completion_id, &input.model, &auth)?;

    Ok(json!({
        "response": base64::engine::general_purpose::STANDARD.encode(&bytes),
        "signature": signature,
    }))
}

/// OutLayer evaluates secret access against the transaction signer, which
/// for Verdict is whoever called `ask`. So the key's real guard is here:
/// `NEAR_PREDECESSOR_ID` is set by the worker from the on-chain request, and
/// `VERDICT_CONTRACT` comes from the owner's encrypted secrets.
fn check_caller() -> Result<(), String> {
    let expected = std::env::var("VERDICT_CONTRACT")
        .map_err(|_| "VERDICT_CONTRACT is not set in the OutLayer secrets".to_owned())?;
    let caller = std::env::var("NEAR_PREDECESSOR_ID").unwrap_or_default();
    if caller != expected {
        return Err(format!("called by {caller:?}, not by {expected}"));
    }
    Ok(())
}

/// The signature is recorded shortly after the completion returns, so a
/// `404` or an "unavailable" body is retried a few times.
fn fetch_signature(completion_id: &str, model: &str, auth: &str) -> Result<Value, String> {
    let url = format!("{NEAR_AI}/v1/signature/{completion_id}");
    let mut last = String::new();
    for attempt in 0..SIGNATURE_ATTEMPTS {
        if attempt > 0 {
            sleep(SIGNATURE_BACKOFF);
        }
        let response = Client::new()
            .get(&url)
            .query(&[("model", model), ("signing_algo", "ecdsa")])
            .header("Authorization", auth)
            .header("Accept", "application/json")
            .connect_timeout(TIMEOUT)
            .send()
            .map_err(|e| format!("signature request failed: {e}"))?;
        let status = response.status();
        let bytes = response
            .body()
            .map_err(|e| format!("cannot read signature: {e}"))?;
        let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        if status == 200 && body.get("error_code").is_none() && body["signature"].is_string() {
            return Ok(body);
        }
        last = format!("{status}: {}", preview(&bytes));
        if status != 404 && status != 200 {
            break;
        }
    }
    Err(format!("no signature for {completion_id} ({last})"))
}

fn preview(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).chars().take(160).collect()
}
