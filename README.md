# Verdict

**AI answers a NEAR contract can verify for itself.**

NEAR AI Cloud runs models inside Intel TDX enclaves and signs every response.
Until now, only off-chain code could check those signatures, so a smart
contract that acted on an AI answer had to trust whoever relayed it. NEAR's
own [`verifiable-ai-dao`](https://github.com/NearDeFi/verifiable-ai-dao)
example says so: verifying the AI is "TODO".

Verdict does the whole check inside a NEAR contract:

1. **A model is admitted** only after the contract verifies, on chain, its
   Intel TDX quote (through NEAR's locked
   [`tee-verifier.testnet`](https://github.com/near/mpc/tree/main/crates/tee-verifier)),
   and that the quote binds the model's signing key to a fresh nonce from
   this contract, runs without debug access, and comes from a pinned NEAR AI
   deployment.
2. **A question is asked once.** The contract writes the request body
   itself and hashes it. A hash-pinned runner inside an
   [OutLayer](https://app.outlayer.ai) TDX worker sends those exact bytes to
   NEAR AI one time and returns the raw response and the model's signature.
3. **The answer is accepted** only if the registered key signed
   `sha256(request)` and `sha256(response)`, and the answer is one of the
   allowed options. The raw response and signature are kept, so anyone can
   check the verdict again from chain state.

Any contract can then act on the answer. `examples/charter-dao` screens DAO
proposals against a charter this way.

> Built for NEAR HACKATHON (Nov 2026). All code in this repository was
> written during the hackathon window. Tracks: Privacy & Private AI,
> AI Security & Defense, Open Innovation.

## Try it

**Recompute a verdict in your browser** (no keys, no network):

1. `cd app && npm install && npm run dev`
2. Open http://localhost:5173 and click request `#0`.
3. See five checks pass in the Verification panel. They are recomputed by
   an implementation that shares no code with the contract.
4. In "Try to change the answer", click **Flip the answer**, then **Check
   this response**. See it refused: "The signature does not cover this
   response".

Without `VITE_VERDICT_CONTRACT` the app shows a sample signed by a fixed
test key and says so in a banner. With it, it reads a live deployment, and
the tamper panel also asks the contract (`check_response`) to judge your edit.

**Verify a real NEAR AI attestation locally** (network, no keys):

1. `cargo run -p verdict-registrar -- policy --model Qwen/Qwen3.8-27B --out /tmp/policy.json`
2. See `Verified deployment: TCB UpToDate, MRTD …, compose …`. The tool
   fetched a live attestation, verified the Intel quote with dcap-qvl (the
   library `tee-verifier` runs), and applied every binding rule the
   contract applies.

**Run every test:** `make test` (Rust workspace, the runner in wasmtime
against a mock NEAR AI, and the app). `make lint` runs rustfmt and clippy
with warnings denied.

## How it fits together

```
          start_registration ─► nonce
NEAR AI ──attestation(nonce)──► verdict-registrar ──register_model──► Verdict ──verify_quote──► tee-verifier
                                (checks locally first)                   │
                                                                         ▼ binding rules + policy
                                                               registered signing key (7 days)

consumer ──ask(model, instructions, submission, options)──► Verdict ──request_execution──► OutLayer (TDX)
                                                              ▲                                │ runner: one POST of
                                                              │                                │ the exact body to
                                                              └──── on_inference ◄─────────────┘ NEAR AI + signature
                                       verify signature over sha256(request) and sha256(response)
                                       ──► Settled { request_id, outcome } to the consumer
```

| Path | What it is |
|---|---|
| [`crates/verdict-core`](crates/verdict-core) | `no_std` rules shared by everything: attestation binding (report_data, MRCONFIGID, RTMR3 replay, compose hash, deployment policy) and the response-signature check. Tested on a real Qwen3.8-27B attestation. |
| [`contracts/verdict`](contracts/verdict) | The NEAR contract: model registry, `ask`, the OutLayer callback, and views that expose every byte needed to re-check an answer. |
| [`runner`](runner) | The OutLayer program (WASI P2). Sends the request once, never retries it, fetches the signature, and refuses callers other than the Verdict contract. |
| [`tools/registrar`](tools/registrar) | CLI that fetches and verifies attestations locally and writes `set_model_policy` / `register_model` arguments. It never signs. |
| [`examples/charter-dao`](examples/charter-dao) | A consumer: proposals are screened against a charter through Verdict before they reach a vote. |
| [`app`](app) | Read-only explorer with in-browser re-verification and a tamper panel. |
| [`SECURITY.md`](SECURITY.md) | Threat model: what is proven, what is trusted, and what is not covered. |

## Using Verdict from a contract

```rust
#[ext_contract(ext_verdict)]
trait Verdict {
    fn ask(&mut self, model: String, instructions: String, submission: String,
           options: Vec<String>, notify: Option<bool>) -> Settled;
}

ext_verdict::ext("verdict.testnet".parse().unwrap())
    .with_attached_deposit(NearToken::from_millinear(150))
    .with_static_gas(Gas::from_tgas(170))
    .ask(model, charter, proposal, vec!["APPROVE".into(), "REJECT".into()], None)
    .then(Self::ext(env::current_account_id()).on_screened(proposal_id));
```

`on_screened` receives `Settled { request_id, outcome }`, where `outcome` is
`answered { answer, reason }` or `failed { reason }`. Options are 2–8 values
of `A-Z`, `0-9` or `_`; instructions and submission are up to 4096 bytes
each. The deposit pays for storing the request and its answer; the rest goes
to OutLayer, which refunds what it does not use.

## Live on testnet

| | |
|---|---|
| Verdict | [`verdict.anshv784.testnet`](https://testnet.nearblocks.io/address/verdict.anshv784.testnet) |
| Consumer | [`charter-dao.anshv784.testnet`](https://testnet.nearblocks.io/address/charter-dao.anshv784.testnet) |
| Registered model | `Qwen/Qwen3.8-27B`, key `0x835ab53d20294ef795906dff21ae4c045336aa26`, TCB `UpToDate` |
| Registration tx | [`5ZAVDFT5…`](https://testnet.nearblocks.io/txns/5ZAVDFT5WHyhxiZK7ZaqnToFztc5EAUAibhYTv7Sn2Lo) |

The registration used live NEAR AI evidence fetched with the contract's
nonce. Gas: `tee-verifier` 175.8 Tgas for the Intel quote, Verdict's binding
rules 7 Tgas, 194.8 Tgas in total.

```sh
near contract call-function as-read-only verdict.anshv784.testnet get_model \
  json-args '{"model":"Qwen/Qwen3.8-27B"}' network-config testnet now
```

## Deploying

`scripts/deploy-testnet.sh` builds everything, deploys both contracts,
stores the runner's secrets in OutLayer, pins the model's deployments and
registers the model with fresh evidence. It needs `near` (near-cli-rs),
`cargo-near`, the `outlayer` CLI, a funded testnet account and a NEAR AI API
key, and it refuses to run without `CONFIRM=yes`.

## Facts checked while building this

- NEAR AI serves `Qwen/Qwen3.8-27B` from more than one instance under one
  signing key, with different OS images and app configurations. A policy is
  therefore a list of `(image, compose hash)` pairs, matched whole.
- `tee-verifier.testnet` has no access keys (it cannot be changed) and was
  built from near/mpc rev `dcd67e0`; Verdict pins its interface to that rev.
- OutLayer evaluates secret access against the transaction signer, not the
  calling contract, so the runner checks `NEAR_PREDECESSOR_ID` itself.

## License

MIT
