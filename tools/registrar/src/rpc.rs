//! Read-only NEAR RPC calls.

use anyhow::{bail, Context, Result};
use base64::Engine;
use serde_json::{json, Value};

pub fn rpc_url(network: &str) -> &'static str {
    match network {
        "mainnet" => "https://rpc.mainnet.near.org",
        _ => "https://rpc.testnet.near.org",
    }
}

/// Calls a view method and decodes its JSON result.
pub async fn view(
    http: &reqwest::Client,
    network: &str,
    contract: &str,
    method: &str,
    args: Value,
) -> Result<Value> {
    let args = base64::engine::general_purpose::STANDARD.encode(args.to_string());
    let response: Value = http
        .post(rpc_url(network))
        .json(&json!({
            "jsonrpc": "2.0",
            "id": "oathline-registrar",
            "method": "query",
            "params": {
                "request_type": "call_function",
                "finality": "final",
                "account_id": contract,
                "method_name": method,
                "args_base64": args,
            }
        }))
        .send()
        .await?
        .json()
        .await?;
    if let Some(error) = response.get("error") {
        bail!("RPC error calling {method}: {error}");
    }
    let bytes: Vec<u8> = serde_json::from_value(response["result"]["result"].clone())
        .with_context(|| format!("unexpected RPC response for {method}: {response}"))?;
    Ok(serde_json::from_slice(&bytes)?)
}
