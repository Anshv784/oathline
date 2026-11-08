//! Interfaces of the contracts Oathline calls.

use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{ext_contract, json_types::U64, AccountId};
use tee_verifier_interface::{Collateral, QuoteBytes, VerificationResult};

/// `tee-verifier.testnet`: NEAR's stateless DCAP verifier (near/mpc).
#[allow(dead_code)]
#[ext_contract(ext_tee_verifier)]
pub trait TeeVerifier {
    #[result_serializer(borsh)]
    fn verify_quote(
        &self,
        #[serializer(borsh)] quote: QuoteBytes,
        #[serializer(borsh)] collateral: Collateral,
    ) -> VerificationResult;
}

/// The subset of `outlayer.testnet`'s `request_execution` that Oathline uses.
#[allow(dead_code)]
#[ext_contract(ext_outlayer)]
pub trait OutLayer {
    fn request_execution(
        &mut self,
        source: ExecutionSource,
        resource_limits: Option<ResourceLimits>,
        input_data: Option<String>,
        secrets_ref: Option<SecretsReference>,
        response_format: Option<ResponseFormat>,
        payer_account_id: Option<AccountId>,
    );
}

/// Implemented by contracts that want to be told when their question is settled.
#[allow(dead_code)]
#[ext_contract(ext_consumer)]
pub trait Consumer {
    fn on_oathline(&mut self, request_id: U64, outcome: crate::views::Outcome);
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "near_sdk::serde")]
pub enum ExecutionSource {
    WasmUrl {
        url: String,
        hash: String,
        build_target: Option<String>,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct ResourceLimits {
    pub max_instructions: Option<u64>,
    pub max_memory_mb: Option<u32>,
    pub max_execution_seconds: Option<u64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct SecretsReference {
    pub profile: String,
    pub account_id: AccountId,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "near_sdk::serde")]
pub enum ResponseFormat {
    Json,
}
