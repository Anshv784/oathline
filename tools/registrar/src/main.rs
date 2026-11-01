//! `verdict-registrar`: prepares the arguments for admitting a model.
//!
//! It never signs or sends a transaction. It writes a JSON file and prints
//! the `near` command to submit it, after running every check the contract
//! will run, so a bad attestation is caught before it costs gas.

mod attestation;
mod rpc;

use std::path::PathBuf;

use anyhow::{bail, Context, Result};
use clap::{Parser, Subcommand};
use rand::RngCore;
use serde_json::json;
use verdict_core::attestation::ModelPolicy;

#[derive(Parser)]
#[command(version, about)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Sample the model's live attestation, verify every instance seen, and
    /// write `set_model_policy` arguments pinning each distinct deployment.
    Policy {
        #[arg(long)]
        model: String,
        /// How many attestations to fetch. NEAR AI load-balances a model
        /// across instances, so one fetch may not see them all.
        #[arg(long, default_value_t = 8)]
        samples: u32,
        #[arg(long, default_value = "policy.json")]
        out: PathBuf,
    },
    /// Fetch the attestation for a nonce from `start_registration`, check it
    /// against the contract's policy, and write `register_model` arguments.
    Evidence {
        #[arg(long)]
        contract: String,
        #[arg(long)]
        model: String,
        #[arg(long)]
        nonce: String,
        #[arg(long, default_value = "testnet")]
        network: String,
        #[arg(long, default_value = "evidence.json")]
        out: PathBuf,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    let http = reqwest::Client::builder()
        .user_agent("verdict-registrar")
        .build()?;
    match Cli::parse().command {
        Command::Policy {
            model,
            samples,
            out,
        } => policy(&http, &model, samples, out).await,
        Command::Evidence {
            contract,
            model,
            nonce,
            network,
            out,
        } => evidence(&http, &contract, &model, &nonce, &network, out).await,
    }
}

async fn policy(http: &reqwest::Client, model: &str, samples: u32, out: PathBuf) -> Result<()> {
    let mut deployments = Vec::new();
    let mut signer = None;
    for _ in 0..samples.max(1) {
        let mut nonce = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut nonce);
        for candidate in attestation::fetch(http, model, &nonce).await? {
            let checked = attestation::verify_quote(&candidate).await?;
            let deployment = attestation::deployment_of(&candidate, &checked);
            // Re-check every binding with a policy of just this deployment, so
            // nothing is pinned that would not register.
            let only = ModelPolicy {
                deployments: vec![deployment.clone()],
            };
            attestation::check_binding(&candidate, &checked, &nonce, &only)?;
            match &signer {
                None => signer = Some(candidate.signing_address.clone()),
                Some(known) if *known != candidate.signing_address => bail!(
                    "instances disagree on the signing key ({known} vs {}); refusing to pin",
                    candidate.signing_address
                ),
                Some(_) => {}
            }
            if !deployments.contains(&deployment) {
                eprintln!(
                    "Verified deployment: TCB {}, MRTD {}…, compose {}",
                    checked.status,
                    &hex::encode(deployment.image.mr_td)[..12],
                    hex::encode(deployment.compose_hash)
                );
                deployments.push(deployment);
            }
        }
    }

    let policy = ModelPolicy { deployments };
    std::fs::write(
        &out,
        serde_json::to_string_pretty(&attestation::policy_json(model, &policy))?,
    )?;
    eprintln!(
        "{} deployment(s), signing key {}. Review {} against NEAR AI's published images, then:",
        policy.deployments.len(),
        signer.unwrap_or_default(),
        out.display()
    );
    eprintln!(
        "  near contract call-function as-transaction <verdict-account> set_model_policy file-args {} \
         prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as <owner> network-config testnet",
        out.display()
    );
    Ok(())
}

async fn evidence(
    http: &reqwest::Client,
    contract: &str,
    model: &str,
    nonce_hex: &str,
    network: &str,
    out: PathBuf,
) -> Result<()> {
    let nonce: [u8; 32] = hex::decode(nonce_hex)
        .ok()
        .and_then(|bytes| bytes.try_into().ok())
        .context("nonce must be 32 hex-encoded bytes")?;
    let expiry = rpc::view(
        http,
        network,
        contract,
        "get_challenge_expiry",
        json!({ "nonce": nonce_hex }),
    )
    .await?;
    if expiry.is_null() {
        bail!("{contract} has no live challenge with this nonce; call start_registration first");
    }
    let policy_view = rpc::view(
        http,
        network,
        contract,
        "get_policy",
        json!({ "model": model }),
    )
    .await?;
    if policy_view.is_null() {
        bail!("{contract} has no policy for {model}");
    }
    let policy = attestation::policy_from_json(&policy_view)?;
    let accepted: Vec<String> = serde_json::from_value(
        rpc::view(http, network, contract, "config", json!({})).await?["accepted_tcb_statuses"]
            .clone(),
    )?;

    let mut failures = Vec::new();
    for candidate in attestation::fetch(http, model, &nonce).await? {
        let result = async {
            let checked = attestation::verify_quote(&candidate).await?;
            if !accepted.contains(&checked.status) {
                bail!(
                    "TCB status {} is not accepted by the contract",
                    checked.status
                );
            }
            attestation::check_binding(&candidate, &checked, &nonce, &policy)?;
            attestation::evidence_json(&candidate, &checked, &nonce)
        }
        .await;
        match result {
            Ok(args) => {
                std::fs::write(&out, serde_json::to_string(&args)?)?;
                eprintln!(
                    "All checks passed for {} ({}).",
                    candidate.model, candidate.signing_address
                );
                eprintln!("Submit within the nonce's lifetime:");
                eprintln!(
                    "  near contract call-function as-transaction {contract} register_model file-args {} \
                     prepaid-gas '300 Tgas' attached-deposit '0 NEAR' sign-as <any-account> network-config {network}",
                    out.display()
                );
                return Ok(());
            }
            Err(error) => failures.push(format!("{}: {error:#}", candidate.signing_address)),
        }
    }
    bail!("no candidate passed:\n  {}", failures.join("\n  "))
}
