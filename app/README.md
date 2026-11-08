# Oathline app

A read-only explorer for a Oathline deployment.

- **Oathlines:** recent requests and their outcomes.
- **A oathline:** the question, the answer, and a verification receipt
  recomputed in the browser by `src/lib/verify.ts`, which shares no code
  with the contract. The tamper panel re-checks an edited response locally
  and with the contract's `check_response` view.
- **Models:** each model's registered key, TCB status, pinned deployments
  and expiry.

```sh
npm install
npm run dev            # offline sample, clearly labelled
VITE_OATHLINE_CONTRACT=verdict.you.testnet npm run dev
npm test               # verify.ts against a fixture exported from oathline-core
```

`src/lib/fixtures/signed.json` comes from
`cargo run -p oathline-core --example export_fixture`. It is signed by a fixed
test key, not a NEAR AI key, and is used for tests and the offline sample.
