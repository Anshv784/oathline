# Threat model

What a stored oathline proves, what it relies on, and what it does not cover.

## What an accepted answer proves

For request `#n`, Oathline stored `answer` only if all of these held when the
answer arrived:

1. The key that signed it was registered for `model` and not revoked. It was
   registered because, within ten minutes of a nonce issued by this contract:
   - `tee-verifier` accepted the Intel TDX quote (signature chain, collateral,
     and a TCB status the owner accepts, `UpToDate` by default);
   - the quote's `report_data` is the signing address followed by that nonce;
   - the TD is not in debug mode;
   - MRCONFIGID commits to the submitted `app_compose`, and the RTMR3 event
     log replays to the quoted RTMR3 and records the same compose hash;
   - MRTD, RTMR0-2 and the compose hash form one of the deployments in the
     owner's policy for `model`.
2. The signed text is `model:sha256(request):sha256(response)`, where the
   request is the body this contract wrote (and tagged with the request id
   and a nonce) and the response is the exact stored bytes.
3. The signature is `provider_tee` (made inside the model enclave, not by
   the NEAR AI gateway) and recovers to the registered key.
4. The response names `model`, finished normally, and its answer is one of
   the allowed options.

Each of these is re-checkable from contract state: `get_request` returns the
fields, `get_request_body` the exact request, and the response and signature
are stored.

## Attacks this stops

| Attack | Why it fails |
|---|---|
| Relayer edits the answer | The signed text includes `sha256(response)`. |
| Relayer swaps in an answer to a different question | The signed text includes `sha256(request)`, and the request carries a per-request tag. |
| Replay of an old signature | Same: the tag makes every request body unique. |
| Answer signed by any other key, including NEAR AI's gateway | Only the registered `provider_tee` key is accepted. |
| Old or recorded attestation | Registration requires a nonce from this contract, used once, within ten minutes. |
| A NEAR AI VM in debug mode, or running other containers or weights | Debug bit, MRCONFIGID/RTMR3 and the pinned deployment list. |
| Ask the model many times and keep the preferred answer | The completion is requested once, inside the OutLayer worker, by a runner pinned by its WASM hash. It never retries the completion. |
| Third parties spending the operator's NEAR AI key | The runner refuses any caller but the configured Oathline contract (`NEAR_PREDECESSOR_ID`). |
| Prompt injection inside the submission | Partly mitigated: the submission is fenced as data and the answer must match a fixed option. The model can still be persuaded; see below. |

## What is trusted

- **Intel TDX** and Intel's collateral, as checked by dcap-qvl in `tee-verifier`.
- **The owner's policy.** The owner chooses which NEAR AI deployments count
  as a model. `oathline-registrar policy` derives them from live, verified
  attestations, but reviewing what the pinned `app_compose` runs (images,
  weights) against NEAR AI's published builds is a human step. The owner can
  also revoke a model and replace the runner hash.
- **OutLayer** to run the pinned runner once per request, keep the API key
  secret, and deliver its output. OutLayer workers are themselves TDX
  attested, but Oathline does not check worker attestations on chain.
- **NEAR AI's signing design**: that `provider_tee` keys never leave model
  enclaves. Instances of one model share a key.

## Not covered

- **NVIDIA GPU evidence.** Model reports include an NVIDIA payload, verified
  through NVIDIA's NRAS service with an ES384 token. NEAR has no cheap P-384
  verification, so this is not checked on chain.
- **Correctness of the answer.** Oathline proves which model answered and
  what it said, not that it is right. Use more than one model and treat
  disagreement as "no decision" when stakes are high.
- **Liveness.** If NEAR AI or OutLayer is down, a request fails and is
  recorded as failed; nothing retries it automatically.
- **Registration lifetime.** A key stays registered for seven days by
  default, or until the policy changes. A compromise discovered inside that
  window needs the owner to call `remove_model`.

## Reporting

Please open a private security advisory on the repository.
