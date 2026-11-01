//! Asking a registered model, and accepting its answer.
//!
//! [`ask`](Verdict::ask) writes the request body itself and stores its hash.
//! OutLayer runs the pinned runner inside a TDX worker, which sends that body
//! to NEAR AI once and returns the raw response and the model's signature.
//! [`on_inference`](Verdict::on_inference) accepts the answer only if the
//! signature is the registered key's, over exactly that request and
//! response. Everything needed to check it again is kept in state.

use base64::Engine;
use near_sdk::json_types::U64;
use near_sdk::serde::Deserialize;
use near_sdk::{env, near, require, AccountId, Gas, NearToken, Promise, PromiseError};
use verdict_core::inference::{verify_response, InferenceRequest, SignedResponse};

use crate::crypto::NearCrypto;
use crate::external::{
    ext_consumer, ext_outlayer, ExecutionSource, ResourceLimits, ResponseFormat, SecretsReference,
};
use crate::views::{CheckView, Outcome, RequestView, Settled};
use crate::{events, Verdict, VerdictExt};

pub const MAX_TEXT_BYTES: usize = 4096;
pub const MAX_RESPONSE_BYTES: usize = 4096;
/// Base64 of the largest accepted response plus the signature object.
const MAX_RUNNER_OUTPUT_BYTES: usize = 16 * 1024;
pub const MAX_TOKENS: u32 = 400;
pub const MAX_OPTIONS: usize = 8;
pub const MAX_OPTION_CHARS: usize = 32;
/// The least OutLayer accepts for one execution.
const OUTLAYER_MIN_DEPOSIT: NearToken = NearToken::from_millinear(10);
const ON_INFERENCE_GAS: Gas = Gas::from_tgas(50);
const CONSUMER_GAS: Gas = Gas::from_tgas(15);
/// OutLayer reserves 50 Tgas for its own settlement callback (`MIN_RESPONSE_GAS`)
/// and needs a little to admit the request; it also gets any unused gas.
const OUTLAYER_GAS: Gas = Gas::from_tgas(80);
/// What `ask` itself needs on top of the two shares above.
const ASK_GAS: Gas = Gas::from_tgas(30);
/// Signature record, answer, reason and Borsh framing of a settled request.
const ANSWER_OVERHEAD_BYTES: usize = 1536;

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SignatureRecord {
    pub text: String,
    pub signature: String,
    pub signing_address: String,
    pub signing_algo: String,
    pub signature_kind: Option<String>,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Status {
    Pending,
    Answered {
        answer: String,
        reason: String,
        completion_id: String,
        response: Vec<u8>,
        signature: SignatureRecord,
        answered_at_ms: u64,
    },
    Failed {
        reason: String,
    },
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Request {
    pub requester: AccountId,
    /// Call `requester.on_verdict(request_id, outcome)` once settled.
    pub notify: bool,
    pub model: String,
    /// The model key at the time of asking; only it may answer.
    pub signer: [u8; 20],
    pub instructions: String,
    pub submission: String,
    pub options: Vec<String>,
    pub tag: String,
    pub request_hash: [u8; 32],
    /// Sent on to OutLayer, which refunds what it does not use to the requester.
    pub forwarded: NearToken,
    pub created_at_ms: u64,
    pub status: Status,
}

impl Request {
    pub fn body(&self) -> String {
        InferenceRequest {
            model: &self.model,
            instructions: &self.instructions,
            submission: &self.submission,
            options: &self.options,
            tag: &self.tag,
            max_tokens: MAX_TOKENS,
        }
        .body()
    }
}

/// What the runner prints to stdout.
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct RunnerOutput {
    response: Option<String>,
    signature: Option<SignedResponse>,
    error: Option<String>,
}

impl From<SignedResponse> for SignatureRecord {
    fn from(signed: SignedResponse) -> Self {
        Self {
            text: signed.text,
            signature: signed.signature,
            signing_address: signed.signing_address,
            signing_algo: signed.signing_algo,
            signature_kind: signed.signature_kind,
        }
    }
}

fn validate_question(instructions: &str, submission: &str, options: &[String]) {
    require!(!instructions.trim().is_empty(), "instructions are empty");
    require!(!submission.trim().is_empty(), "submission is empty");
    require!(
        instructions.len() <= MAX_TEXT_BYTES,
        "instructions exceed 4096 bytes"
    );
    require!(
        submission.len() <= MAX_TEXT_BYTES,
        "submission exceeds 4096 bytes"
    );
    require!(
        (2..=MAX_OPTIONS).contains(&options.len()),
        "give between 2 and 8 options"
    );
    for (index, option) in options.iter().enumerate() {
        require!(
            !option.is_empty()
                && option.len() <= MAX_OPTION_CHARS
                && option
                    .bytes()
                    .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_'),
            "options must be 1-32 characters of A-Z, 0-9 or _"
        );
        require!(
            !options[..index].contains(option),
            "options must be distinct"
        );
    }
}

#[near]
impl Verdict {
    /// Asks `model` to pick one of `options` for `submission`, judged by
    /// `instructions`. With `notify`, the caller's `on_verdict(request_id,
    /// outcome)` is called once the answer is settled.
    ///
    /// The attached deposit pays for storing the request and its answer;
    /// the rest goes to OutLayer, which refunds the unused part to the caller.
    #[payable]
    pub fn ask(
        &mut self,
        model: String,
        instructions: String,
        submission: String,
        options: Vec<String>,
        notify: Option<bool>,
    ) -> Promise {
        validate_question(&instructions, &submission, &options);
        let registered = self
            .models
            .get(&model)
            .unwrap_or_else(|| env::panic_str("model is not registered"));
        require!(
            env::block_timestamp_ms() < registered.expires_at_ms,
            "model registration expired"
        );
        let signer = registered.signing_address;

        let id = self.requests.len() as u64;
        let nonce = self.fresh_nonce(b"ask");
        let tag = format!(
            "{}#{}:{}",
            env::current_account_id(),
            id,
            hex::encode(&nonce[..8])
        );
        let requester = env::predecessor_account_id();

        let mut request = Request {
            requester: requester.clone(),
            notify: notify.unwrap_or(false),
            model: model.clone(),
            signer,
            instructions,
            submission,
            options,
            tag,
            request_hash: [0; 32],
            forwarded: NearToken::from_yoctonear(0),
            created_at_ms: env::block_timestamp_ms(),
            status: Status::Pending,
        };
        let body = request.body();
        request.request_hash = env::sha256_array(body.as_bytes());

        // Reserve room for the answer up front so the callback never spends
        // the contract's own balance on storage.
        let request_bytes = borsh::to_vec(&request).map_or(0, |bytes| bytes.len());
        let reserved = request_bytes + MAX_RESPONSE_BYTES + ANSWER_OVERHEAD_BYTES;
        let storage_cost = env::storage_byte_cost().saturating_mul(reserved as u128);
        let deposit = env::attached_deposit();
        let forwarded = deposit.saturating_sub(storage_cost);
        require!(
            forwarded >= OUTLAYER_MIN_DEPOSIT,
            format!(
                "attach at least {} yoctoNEAR",
                storage_cost
                    .saturating_add(OUTLAYER_MIN_DEPOSIT)
                    .as_yoctonear()
            )
        );
        request.forwarded = forwarded;
        events::asked(id, &request);
        self.requests.push(request);

        require!(
            env::prepaid_gas()
                >= OUTLAYER_GAS
                    .saturating_add(ON_INFERENCE_GAS)
                    .saturating_add(ASK_GAS),
            "attach at least 160 Tgas"
        );

        let input = near_sdk::serde_json::json!({ "model": model, "body": body }).to_string();
        ext_outlayer::ext(self.outlayer.clone())
            .with_attached_deposit(forwarded)
            .with_static_gas(OUTLAYER_GAS)
            .with_unused_gas_weight(1)
            .request_execution(
                ExecutionSource::WasmUrl {
                    url: self.runner.url.clone(),
                    hash: self.runner.sha256.clone(),
                    build_target: Some("wasm32-wasip2".to_owned()),
                },
                Some(ResourceLimits {
                    max_instructions: Some(10_000_000_000),
                    max_memory_mb: Some(128),
                    max_execution_seconds: Some(90),
                }),
                Some(input),
                Some(SecretsReference {
                    profile: self.secrets.profile.clone(),
                    account_id: self.secrets.account_id.clone(),
                }),
                Some(ResponseFormat::Json),
                Some(requester),
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(ON_INFERENCE_GAS)
                    .on_inference(U64(id)),
            )
    }

    /// Receives the runner's output from OutLayer and settles the request.
    /// Its return value is what a contract chaining `.then` on `ask` receives.
    #[private]
    pub fn on_inference(&mut self, request_id: U64) -> Settled {
        let id = request_id.0;
        let mut request = self
            .requests
            .get(id as u32)
            .cloned()
            .unwrap_or_else(|| env::panic_str("unknown request"));
        require!(request.status == Status::Pending, "request already settled");

        let status = match env::promise_result_checked(0, MAX_RUNNER_OUTPUT_BYTES) {
            Ok(bytes) => self.settle(&request, &bytes),
            // OutLayer rejected `request_execution` itself, so NEAR returned
            // the attached deposit to this contract: pass it back. (When the
            // call was admitted, OutLayer settles timeouts and refunds the
            // payer, the requester, on its own.)
            Err(PromiseError::Failed) => {
                Promise::new(request.requester.clone())
                    .transfer(request.forwarded)
                    .detach();
                Status::Failed {
                    reason: "OutLayer did not run the request".to_owned(),
                }
            }
            // Too long (or any future variant): the runner ran and OutLayer
            // kept its fee, so nothing came back to refund.
            Err(_) => Status::Failed {
                reason: "runner output is too large".to_owned(),
            },
        };
        request.status = status;
        let outcome = Outcome::from(&request.status);
        events::settled(id, &request);

        if request.notify {
            ext_consumer::ext(request.requester.clone())
                .with_static_gas(CONSUMER_GAS)
                .on_verdict(request_id, outcome.clone())
                .detach();
        }
        self.requests.replace(id as u32, request);
        Settled {
            request_id,
            outcome,
        }
    }

    pub fn get_request(&self, request_id: U64) -> Option<RequestView> {
        self.requests
            .get(request_id.0 as u32)
            .map(|request| RequestView::new(request_id.0, request))
    }

    /// Newest first.
    pub fn list_requests(&self, from_index: Option<U64>, limit: Option<u32>) -> Vec<RequestView> {
        let total = self.requests.len() as u64;
        let start = from_index.map_or(total, |index| index.0.min(total));
        let limit = limit.unwrap_or(20).min(50) as u64;
        (start.saturating_sub(limit)..start)
            .rev()
            .filter_map(|id| {
                self.requests
                    .get(id as u32)
                    .map(|request| RequestView::new(id, request))
            })
            .collect()
    }

    pub fn requests_count(&self) -> U64 {
        U64(self.requests.len() as u64)
    }

    /// The exact bytes that were sent to the model. `sha256` of this string
    /// is the `request_hash` the signature must cover.
    pub fn get_request_body(&self, request_id: U64) -> Option<String> {
        self.requests.get(request_id.0 as u32).map(Request::body)
    }

    /// Runs the acceptance check on any response and signature against a
    /// stored request, without changing state. Used to show that an edited
    /// answer, or one signed by another key, would have been refused.
    pub fn check_response(
        &self,
        request_id: U64,
        response_base64: String,
        signature: SignedResponse,
    ) -> CheckView {
        let Some(request) = self.requests.get(request_id.0 as u32) else {
            return CheckView::rejected("unknown request");
        };
        let Ok(response) = base64::engine::general_purpose::STANDARD.decode(&response_base64)
        else {
            return CheckView::rejected("response is not base64");
        };
        match verify_response(
            &NearCrypto,
            &request.model,
            &request.request_hash,
            &response,
            &signature,
            &request.signer,
            &request.options,
        ) {
            Ok(verdict) => CheckView::accepted(verdict.answer, verdict.reason),
            Err(error) => CheckView::rejected(&error.to_string()),
        }
    }
}

impl Verdict {
    fn settle(&self, request: &Request, output: &[u8]) -> Status {
        let failed = |reason: &str| Status::Failed {
            reason: reason.to_owned(),
        };

        let output: Option<RunnerOutput> = match near_sdk::serde_json::from_slice(output) {
            Ok(output) => output,
            Err(_) => return failed("runner output is not JSON"),
        };
        let Some(output) = output else {
            return failed("runner failed inside OutLayer");
        };
        if let Some(error) = output.error {
            return failed(&format!("runner: {}", truncate(&error, 200)));
        }
        let (Some(response), Some(signature)) = (output.response, output.signature) else {
            return failed("runner returned no response");
        };
        let Ok(response) = base64::engine::general_purpose::STANDARD.decode(response) else {
            return failed("response is not base64");
        };
        if response.len() > MAX_RESPONSE_BYTES {
            return failed("response is larger than 4096 bytes");
        }
        // The owner may have revoked the key since the question was asked.
        let still_registered = self
            .models
            .get(&request.model)
            .is_some_and(|model| model.signing_address == request.signer);
        if !still_registered {
            return failed("model key was revoked before the answer arrived");
        }

        match verify_response(
            &NearCrypto,
            &request.model,
            &request.request_hash,
            &response,
            &signature,
            &request.signer,
            &request.options,
        ) {
            Ok(verdict) => Status::Answered {
                answer: verdict.answer,
                reason: verdict.reason,
                completion_id: verdict.completion_id,
                response,
                signature: signature.into(),
                answered_at_ms: env::block_timestamp_ms(),
            },
            Err(error) => failed(&error.to_string()),
        }
    }
}

fn truncate(text: &str, max: usize) -> &str {
    match text.char_indices().nth(max) {
        Some((end, _)) => &text[..end],
        None => text,
    }
}
