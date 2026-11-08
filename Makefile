# Every check that runs without network access or keys.
.PHONY: test test-rust test-runner test-app lint build

test: test-rust test-runner test-app

test-rust:
	cargo test --workspace

test-runner:
	runner/tests/run.sh

test-app:
	cd app && npm ci --silent && npm test && npm run typecheck

lint:
	cargo fmt --all --check
	cargo clippy -p oathline-core -p oathline-registrar --all-targets -- -D warnings
	cargo clippy -p oathline-contract -p charter-dao -p oathline-market --target wasm32-unknown-unknown -- -D warnings
	cd runner && cargo clippy --release --target wasm32-wasip2 -- -D warnings

# Release artifacts: the two contracts (needs cargo-near) and the runner.
build:
	cd contracts/oathline && cargo near build non-reproducible-wasm
	cd examples/charter-dao && cargo near build non-reproducible-wasm
	cd examples/oathline-market && cargo near build non-reproducible-wasm
	cd runner && cargo build --release --target wasm32-wasip2
	@shasum -a 256 runner/target/wasm32-wasip2/release/oathline-runner.wasm
