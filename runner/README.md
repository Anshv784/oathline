# oathline-runner

The program OutLayer runs inside a TDX worker for each `ask`. It:

1. refuses unless `NEAR_PREDECESSOR_ID` equals `OATHLINE_CONTRACT` from its secrets;
2. POSTs the request body it was given, byte for byte, to
   `https://cloud-api.near.ai/v1/chat/completions` exactly once, with
   `x-no-aliasing: true` and `Accept-Encoding: identity`;
3. fetches the `ecdsa` signature for that completion, retrying only this
   lookup (the signature is recorded shortly after the completion);
4. prints `{"response": <base64 of the raw bytes>, "signature": {...}}`, or
   `{"error": ...}`.

It does not judge the answer; the contract does.

## Secrets (stored with `outlayer secrets set`)

| Name | Value |
|---|---|
| `NEARAI_API_KEY` | A NEAR AI Cloud API key |
| `OATHLINE_CONTRACT` | The Oathline contract account, e.g. `verdict.you.testnet` |

## Build and pin

```sh
cargo build --release --target wasm32-wasip2
shasum -a 256 target/wasm32-wasip2/release/oathline-runner.wasm
```

The contract runs the runner only by that hash (`set_runner`). The NEAR AI
URL is fixed at build time, so a build pointing anywhere else has a
different hash.

## Test

`tests/run.sh` builds a copy pointed at a local mock of NEAR AI and runs it
in wasmtime. It checks the caller refusal, that exactly one completion is
requested with the exact body and length, and that the signature lookup is
retried after a 404.
