//! A DAO that screens proposals against its charter before they go to a vote.
//!
//! This is NEAR's `verifiable-ai-dao` example with the missing piece in
//! place: the decision is not taken from whoever relays it. Each proposal is
//! sent to Verdict, which accepts the model's answer only after checking, on
//! chain, that the registered NEAR AI enclave signed exactly this request and
//! response. The DAO then records `request_id`, so anyone can re-check the
//! decision against Verdict's stored proof.

use near_sdk::json_types::U64;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::store::Vector;
use near_sdk::{
    env, ext_contract, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault,
    Promise, PromiseError,
};

const MAX_TITLE_CHARS: usize = 120;
const MAX_DESCRIPTION_BYTES: usize = 3000;
/// Enough for `ask` (160 Tgas) and its callback chain.
const VERDICT_GAS: Gas = Gas::from_tgas(170);
const ON_SCREENED_GAS: Gas = Gas::from_tgas(15);
/// Covers Verdict's storage for the request and answer, plus OutLayer.
pub const SCREENING_DEPOSIT: NearToken = NearToken::from_millinear(150);

/// Mirrors Verdict's `Outcome`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(crate = "near_sdk::serde", tag = "status", rename_all = "snake_case")]
pub enum Outcome {
    Pending,
    Answered { answer: String, reason: String },
    Failed { reason: String },
}

/// Mirrors Verdict's `Settled`: what `ask` resolves to.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(crate = "near_sdk::serde")]
pub struct Settled {
    pub request_id: U64,
    pub outcome: Outcome,
}

#[allow(dead_code)]
#[ext_contract(ext_verdict)]
trait Verdict {
    fn ask(
        &mut self,
        model: String,
        instructions: String,
        submission: String,
        options: Vec<String>,
        notify: Option<bool>,
    ) -> Settled;
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum Screening {
    InReview,
    /// Passed the charter check; ready for a member vote.
    Approved {
        reason: String,
    },
    /// Outside the charter; it does not go to a vote.
    Rejected {
        reason: String,
    },
    /// No verified decision could be made. The deposit was not spent on a
    /// decision, and the proposer may submit again.
    NotScreened {
        reason: String,
    },
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Proposal {
    pub id: U64,
    pub proposer: AccountId,
    pub title: String,
    pub description: String,
    pub submitted_at_ms: U64,
    /// Verdict's request id, once the screening settles.
    pub verdict_request: Option<U64>,
    pub screening: Screening,
}

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Proposals,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct CharterDao {
    verdict: AccountId,
    model: String,
    charter: String,
    proposals: Vector<Proposal>,
}

#[near]
impl CharterDao {
    #[init]
    pub fn new(verdict: AccountId, model: String, charter: String) -> Self {
        require!(!charter.trim().is_empty(), "the charter is empty");
        Self {
            verdict,
            model,
            charter,
            proposals: Vector::new(StorageKey::Proposals),
        }
    }

    /// Files a proposal and sends it for screening. Attach
    /// `SCREENING_DEPOSIT` (0.15 NEAR) and 300 Tgas.
    #[payable]
    pub fn submit_proposal(&mut self, title: String, description: String) -> Promise {
        require!(
            !title.trim().is_empty() && title.chars().count() <= MAX_TITLE_CHARS,
            "the title must be 1-120 characters"
        );
        require!(
            !description.trim().is_empty() && description.len() <= MAX_DESCRIPTION_BYTES,
            "the description must be 1-3000 bytes"
        );
        require!(
            env::attached_deposit() >= SCREENING_DEPOSIT,
            "attach 0.15 NEAR to pay for screening"
        );

        let id = self.proposals.len() as u64;
        let submission = format!("Title: {title}\n\n{description}");
        self.proposals.push(Proposal {
            id: U64(id),
            proposer: env::predecessor_account_id(),
            title,
            description,
            submitted_at_ms: U64(env::block_timestamp_ms()),
            verdict_request: None,
            screening: Screening::InReview,
        });

        ext_verdict::ext(self.verdict.clone())
            .with_attached_deposit(env::attached_deposit())
            .with_static_gas(VERDICT_GAS)
            .with_unused_gas_weight(1)
            .ask(
                self.model.clone(),
                self.charter.clone(),
                submission,
                vec!["APPROVE".to_owned(), "REJECT".to_owned()],
                None,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(ON_SCREENED_GAS)
                    .on_screened(U64(id), env::attached_deposit()),
            )
    }

    #[private]
    pub fn on_screened(
        &mut self,
        proposal_id: U64,
        deposit: NearToken,
        #[callback_result] result: Result<Settled, PromiseError>,
    ) -> Proposal {
        let index = proposal_id.0 as u32;
        let mut proposal = self
            .proposals
            .get(index)
            .cloned()
            .unwrap_or_else(|| env::panic_str("unknown proposal"));

        proposal.screening = match result {
            Ok(settled) => {
                proposal.verdict_request = Some(settled.request_id);
                match settled.outcome {
                    Outcome::Answered { answer, reason } if answer == "APPROVE" => {
                        Screening::Approved { reason }
                    }
                    Outcome::Answered { reason, .. } => Screening::Rejected { reason },
                    Outcome::Failed { reason } => Screening::NotScreened { reason },
                    Outcome::Pending => Screening::NotScreened {
                        reason: "screening did not settle".to_owned(),
                    },
                }
            }
            Err(_) => {
                // Verdict refused the call, so the deposit came back here.
                Promise::new(proposal.proposer.clone())
                    .transfer(deposit)
                    .detach();
                Screening::NotScreened {
                    reason: "Verdict did not accept the request".to_owned(),
                }
            }
        };
        self.proposals.replace(index, proposal.clone());
        proposal
    }

    pub fn get_proposal(&self, proposal_id: U64) -> Option<Proposal> {
        self.proposals.get(proposal_id.0 as u32).cloned()
    }

    /// Newest first.
    pub fn list_proposals(&self, from_index: Option<U64>, limit: Option<u32>) -> Vec<Proposal> {
        let total = self.proposals.len() as u64;
        let start = from_index.map_or(total, |index| index.0.min(total));
        let limit = u64::from(limit.unwrap_or(20).min(50));
        (start.saturating_sub(limit)..start)
            .rev()
            .filter_map(|id| self.proposals.get(id as u32).cloned())
            .collect()
    }

    pub fn charter(&self) -> String {
        self.charter.clone()
    }

    pub fn verdict(&self) -> (AccountId, String) {
        (self.verdict.clone(), self.model.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    const CHARTER: &str = "Fund open-source developer tooling for NEAR. No token launches.";

    fn context(predecessor: AccountId) -> VMContextBuilder {
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id("dao.testnet".parse().unwrap())
            .predecessor_account_id(predecessor.clone())
            .signer_account_id(predecessor)
            .prepaid_gas(Gas::from_tgas(300));
        builder
    }

    fn dao_with_proposal() -> CharterDao {
        testing_env!(context(accounts(0)).build());
        let mut dao = CharterDao::new(
            "verdict.testnet".parse().unwrap(),
            "Qwen/Qwen3.8-27B".into(),
            CHARTER.into(),
        );
        testing_env!(context(accounts(1))
            .attached_deposit(SCREENING_DEPOSIT)
            .build());
        let _ = dao.submit_proposal(
            "NEAR contract linter".into(),
            "An MIT-licensed linter for near-sdk contracts.".into(),
        );
        testing_env!(context("dao.testnet".parse().unwrap()).build());
        dao
    }

    fn settled(outcome: Outcome) -> Result<Settled, PromiseError> {
        Ok(Settled {
            request_id: U64(7),
            outcome,
        })
    }

    #[test]
    fn new_proposals_wait_for_screening() {
        let dao = dao_with_proposal();
        let proposal = dao.get_proposal(U64(0)).unwrap();
        assert_eq!(proposal.screening, Screening::InReview);
        assert_eq!(proposal.proposer, accounts(1));
    }

    #[test]
    fn approval_is_recorded_with_its_verdict_request() {
        let mut dao = dao_with_proposal();
        let proposal = dao.on_screened(
            U64(0),
            SCREENING_DEPOSIT,
            settled(Outcome::Answered {
                answer: "APPROVE".into(),
                reason: "Open-source tooling.".into(),
            }),
        );
        assert_eq!(
            proposal.screening,
            Screening::Approved {
                reason: "Open-source tooling.".into()
            }
        );
        assert_eq!(proposal.verdict_request, Some(U64(7)));
    }

    #[test]
    fn rejection_is_recorded() {
        let mut dao = dao_with_proposal();
        let proposal = dao.on_screened(
            U64(0),
            SCREENING_DEPOSIT,
            settled(Outcome::Answered {
                answer: "REJECT".into(),
                reason: "A token launch.".into(),
            }),
        );
        assert_eq!(
            proposal.screening,
            Screening::Rejected {
                reason: "A token launch.".into()
            }
        );
    }

    #[test]
    fn an_unverified_answer_never_approves() {
        let mut dao = dao_with_proposal();
        let proposal = dao.on_screened(
            U64(0),
            SCREENING_DEPOSIT,
            settled(Outcome::Failed {
                reason: "signed text does not match this request and response".into(),
            }),
        );
        assert!(matches!(proposal.screening, Screening::NotScreened { .. }));
    }

    #[test]
    fn a_refused_call_is_not_screened() {
        let mut dao = dao_with_proposal();
        let proposal = dao.on_screened(U64(0), SCREENING_DEPOSIT, Err(PromiseError::Failed));
        assert_eq!(
            proposal.screening,
            Screening::NotScreened {
                reason: "Verdict did not accept the request".into()
            }
        );
    }

    #[test]
    #[should_panic(expected = "attach 0.15 NEAR to pay for screening")]
    fn screening_must_be_paid_for() {
        testing_env!(context(accounts(0)).build());
        let mut dao = CharterDao::new(
            "verdict.testnet".parse().unwrap(),
            "m".into(),
            CHARTER.into(),
        );
        let _ = dao.submit_proposal("t".into(), "d".into());
    }
}
