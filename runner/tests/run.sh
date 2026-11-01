#!/usr/bin/env bash
# Runs the runner in wasmtime against tests/mock_near_ai.py and checks that
# it forwards the exact body once, retries only the signature, and prints
# the raw response.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT=${PORT:-8787}
WORK=$(mktemp -d)
trap 'kill $SERVER 2>/dev/null; wait $SERVER 2>/dev/null || true; rm -rf "$WORK"' EXIT

VERDICT_NEAR_AI_URL="http://127.0.0.1:$PORT" \
  cargo build -q --release --target wasm32-wasip2 --target-dir "$WORK/target"
WASM="$WORK/target/wasm32-wasip2/release/verdict-runner.wasm"

python3 tests/mock_near_ai.py "$PORT" "$WORK/requests.log" &
SERVER=$!
sleep 0.5

BODY='{"model":"Qwen/Qwen3.8-27B","messages":[{"role":"user","content":"exact bytes é"}]}'
INPUT=$(python3 -c 'import json,sys; print(json.dumps({"model":"Qwen/Qwen3.8-27B","body":sys.argv[1]}))' "$BODY")

run() {
  printf '%s' "$INPUT" | wasmtime run -S http --env NEARAI_API_KEY=test-key \
    --env VERDICT_CONTRACT=verdict.testnet --env NEAR_PREDECESSOR_ID="$1" "$WASM"
}

# Any caller but the configured contract is refused before NEAR AI is called.
REFUSED=$(run someone-else.testnet)
case "$REFUSED" in
  *'"error":"called by \"someone-else.testnet\", not by verdict.testnet"'*) ;;
  *) echo "expected a refusal, got: $REFUSED"; exit 1 ;;
esac
[ ! -s "$WORK/requests.log" ] || { echo "a refused caller reached NEAR AI"; exit 1; }

OUTPUT=$(run verdict.testnet)

python3 - "$WORK/requests.log" "$BODY" "$OUTPUT" <<'PY'
import base64, hashlib, json, sys
log = [json.loads(line) for line in open(sys.argv[1])]
body, output = sys.argv[2].encode(), json.loads(sys.argv[3])

posts = [entry for entry in log if entry["path"] == "/v1/chat/completions"]
gets = [entry for entry in log if entry["path"].startswith("/v1/signature/")]
assert len(posts) == 1, f"expected one completion request, saw {len(posts)}"
assert posts[0]["sha256"] == hashlib.sha256(body).hexdigest(), "body was not forwarded byte for byte"
assert posts[0]["auth"] == "Bearer test-key"
assert posts[0]["no_aliasing"] == "true" and posts[0]["encoding"] == "identity"
assert posts[0]["length"] == str(len(body)), "Content-Length must be the exact body length"
assert len(gets) == 2 and "signing_algo=ecdsa" in gets[0]["path"], gets
assert "error" not in output, output
raw = base64.b64decode(output["response"])
assert output["signature"]["text"].endswith(hashlib.sha256(raw).hexdigest())
print("runner: foreign caller refused; one completion, exact body, signature retried once, raw response returned")
PY
