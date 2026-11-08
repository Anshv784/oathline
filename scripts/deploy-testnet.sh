#!/usr/bin/env bash
# Deploys Oathline and charter-dao to NEAR testnet and admits one model.
#
# Needs: near (near-cli-rs), cargo-near, the outlayer CLI, a funded testnet
# account in your keychain, and a NEAR AI API key with credits.
#
#   OWNER=you.testnet RUNNER_URL=https://.../oathline-runner.wasm \
#   NEARAI_API_KEY=... CONFIRM=yes scripts/deploy-testnet.sh
#
# RUNNER_URL must serve exactly runner/target/wasm32-wasip2/release/oathline-runner.wasm;
# OutLayer refuses to run it if the SHA-256 differs from the one pinned here.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${OWNER:?set OWNER to your testnet account}"
: "${RUNNER_URL:?set RUNNER_URL to a public URL of the runner wasm}"
: "${NEARAI_API_KEY:?set NEARAI_API_KEY}"
[ "${CONFIRM:-}" = "yes" ] || { echo "This sends testnet transactions. Re-run with CONFIRM=yes."; exit 1; }

MODEL=${MODEL:-Qwen/Qwen3.8-27B}
OATHLINE=${OATHLINE:-verdict.$OWNER}
DAO=${DAO:-charter-dao.$OWNER}
NET=(network-config testnet)
SIGN=(sign-with-keychain send)

step() { printf '\n== %s\n' "$*"; }

step "Build"
make build
RUNNER_SHA=$(shasum -a 256 runner/target/wasm32-wasip2/release/oathline-runner.wasm | cut -d' ' -f1)
curl -fsSL "$RUNNER_URL" | shasum -a 256 | grep -q "$RUNNER_SHA" \
  || { echo "RUNNER_URL does not serve the runner just built ($RUNNER_SHA)"; exit 1; }

step "Create $OATHLINE and $DAO"
near account create-account fund-myself "$OATHLINE" '4.5 NEAR' autogenerate-new-keypair save-to-keychain \
  sign-as "$OWNER" "${NET[@]}" "${SIGN[@]}"
near account create-account fund-myself "$DAO" '2 NEAR' autogenerate-new-keypair save-to-keychain \
  sign-as "$OWNER" "${NET[@]}" "${SIGN[@]}"

step "Deploy Oathline"
near contract deploy "$OATHLINE" use-file target/near/oathline_contract/oathline_contract.wasm \
  with-init-call new json-args "$(cat <<JSON
{"owner_id":"$OWNER","tee_verifier":"tee-verifier.testnet","outlayer":"outlayer.testnet",
 "runner":{"url":"$RUNNER_URL","sha256":"$RUNNER_SHA"},
 "secrets":{"profile":"default","account_id":"$OWNER"}}
JSON
)" prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' "${NET[@]}" "${SIGN[@]}"

step "Store the runner's secrets in OutLayer (encrypted to its TEE keystore)"
outlayer secrets set "{\"NEARAI_API_KEY\":\"$NEARAI_API_KEY\",\"OATHLINE_CONTRACT\":\"$OATHLINE\"}" \
  --profile default --wasm-hash "$RUNNER_SHA"

step "Pin the model's deployments (verified locally first)"
cargo run -q -p oathline-registrar -- policy --model "$MODEL" --out target/policy.json
near contract call-function as-transaction "$OATHLINE" set_model_policy file-args target/policy.json \
  prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' sign-as "$OWNER" "${NET[@]}" "${SIGN[@]}"

step "Register the model with fresh evidence"
NONCE=$(near contract call-function as-transaction "$OATHLINE" start_registration json-args "{\"model\":\"$MODEL\"}" \
  prepaid-gas '30.0 Tgas' attached-deposit '0.02 NEAR' sign-as "$OWNER" "${NET[@]}" "${SIGN[@]}" 2>&1 \
  | grep -oE '"[0-9a-f]{64}"' | tail -1 | tr -d '"')
cargo run -q -p oathline-registrar -- evidence --contract "$OATHLINE" --model "$MODEL" --nonce "$NONCE" \
  --out target/evidence.json
near contract call-function as-transaction "$OATHLINE" register_model file-args target/evidence.json \
  prepaid-gas '300.0 Tgas' attached-deposit '0 NEAR' sign-as "$OWNER" "${NET[@]}" "${SIGN[@]}"
near contract call-function as-read-only "$OATHLINE" get_model json-args "{\"model\":\"$MODEL\"}" "${NET[@]}" now

step "Deploy charter-dao"
near contract deploy "$DAO" use-file target/near/charter_dao/charter_dao.wasm \
  with-init-call new json-args "$(cat <<JSON
{"oathline":"$OATHLINE","model":"$MODEL",
 "charter":"We fund open-source developer tooling for NEAR: libraries, CLIs, testing and security tools. We do not fund token launches, closed-source products or marketing."}
JSON
)" prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' "${NET[@]}" "${SIGN[@]}"

printf '\nDone. Point the app at it:\n  echo VITE_OATHLINE_CONTRACT=%s > app/.env.local\n' "$OATHLINE"
