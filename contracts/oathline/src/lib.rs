//! Oathline: AI answers that a NEAR contract can check for itself.
//!
//! A model is admitted once, by proving on-chain that its response-signing
//! key lives in a measured NEAR AI enclave ([`registry`]). After that, any
//! contract can [`ask`](Oathline::ask) it a question. The request body is
//! written here, the model is called exactly once from inside an OutLayer
//! enclave, and the answer is stored only if the model's signature covers
//! the exact request and response bytes ([`requests`]).

use near_sdk::store::{IterableMap, LookupMap, Vector};
use near_sdk::{env, near, require, AccountId, BorshStorageKey, PanicOnDefault};

mod crypto;
mod events;
mod external;
mod registry;
mod requests;
pub mod views;

pub use registry::{Challenge, PendingRegistration, RegisteredModel, StoredImage, StoredPolicy};
pub use requests::{Request, SignatureRecord, Status};

const DEFAULT_REGISTRATION_TTL_MS: u64 = 7 * 24 * 60 * 60 * 1000;

/// The OutLayer program that calls NEAR AI, pinned by the SHA-256 of its WASM.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Runner {
    pub url: String,
    pub sha256: String,
}

/// Where OutLayer finds the encrypted NEAR AI API key for the runner.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Secrets {
    pub profile: String,
    pub account_id: AccountId,
}

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Policies,
    Models,
    Challenges,
    Requests,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Oathline {
    owner_id: AccountId,
    tee_verifier: AccountId,
    outlayer: AccountId,
    runner: Runner,
    secrets: Secrets,
    registration_ttl_ms: u64,
    accepted_tcb_statuses: Vec<String>,
    policies: IterableMap<String, StoredPolicy>,
    models: IterableMap<String, RegisteredModel>,
    challenges: LookupMap<[u8; 32], Challenge>,
    requests: Vector<Request>,
    nonce_counter: u64,
}

#[near]
impl Oathline {
    #[init]
    pub fn new(
        owner_id: AccountId,
        tee_verifier: AccountId,
        outlayer: AccountId,
        runner: Runner,
        secrets: Secrets,
    ) -> Self {
        Self {
            owner_id,
            tee_verifier,
            outlayer,
            runner,
            secrets,
            registration_ttl_ms: DEFAULT_REGISTRATION_TTL_MS,
            accepted_tcb_statuses: vec!["UpToDate".to_owned()],
            policies: IterableMap::new(StorageKey::Policies),
            models: IterableMap::new(StorageKey::Models),
            challenges: LookupMap::new(StorageKey::Challenges),
            requests: Vector::new(StorageKey::Requests),
            nonce_counter: 0,
        }
    }

    // Owner settings. The owner decides which model images are trusted;
    // nobody, including the owner, can register a key without evidence.

    pub fn set_runner(&mut self, runner: Runner) {
        self.assert_owner();
        require!(
            runner.sha256.len() == 64 && hex::decode(&runner.sha256).is_ok(),
            "runner.sha256 must be 32 hex-encoded bytes"
        );
        events::runner_updated(&runner);
        self.runner = runner;
    }

    pub fn set_secrets(&mut self, secrets: Secrets) {
        self.assert_owner();
        self.secrets = secrets;
    }

    pub fn set_registration_ttl_ms(&mut self, registration_ttl_ms: near_sdk::json_types::U64) {
        self.assert_owner();
        require!(registration_ttl_ms.0 > 0, "ttl must be positive");
        self.registration_ttl_ms = registration_ttl_ms.0;
    }

    pub fn set_accepted_tcb_statuses(&mut self, statuses: Vec<String>) {
        self.assert_owner();
        require!(
            !statuses.is_empty(),
            "at least one TCB status must be accepted"
        );
        self.accepted_tcb_statuses = statuses;
    }

    pub fn set_owner(&mut self, owner_id: AccountId) {
        self.assert_owner();
        self.owner_id = owner_id;
    }

    pub fn config(&self) -> views::ConfigView {
        views::ConfigView {
            owner_id: self.owner_id.clone(),
            tee_verifier: self.tee_verifier.clone(),
            outlayer: self.outlayer.clone(),
            runner: self.runner.clone(),
            secrets: self.secrets.clone(),
            registration_ttl_ms: self.registration_ttl_ms.into(),
            accepted_tcb_statuses: self.accepted_tcb_statuses.clone(),
        }
    }
}

impl Oathline {
    fn assert_owner(&self) {
        require!(
            env::predecessor_account_id() == self.owner_id,
            "only the owner can do this"
        );
    }

    /// 32 bytes no two calls share: the block's random seed, a counter and a
    /// domain label, hashed together.
    fn fresh_nonce(&mut self, label: &[u8]) -> [u8; 32] {
        self.nonce_counter += 1;
        let mut material = env::random_seed_array().to_vec();
        material.extend_from_slice(&self.nonce_counter.to_le_bytes());
        material.extend_from_slice(label);
        env::sha256_array(&material)
    }
}

#[cfg(test)]
mod tests;
