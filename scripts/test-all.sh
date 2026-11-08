#!/usr/bin/env bash
# `pnpm test`: every offline suite. Needs Rust (with wasm32-wasip2), Node 22+ and pnpm.
# The browser tests (`pnpm --filter web e2e`) and the reproducible-build check
# (`scripts/p2-check.sh`, needs Docker) are separate because they need more setup.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
echo "== enclave (Rust)";              (cd enclave && cargo test --quiet)
echo "== registry contract (Rust)";    (cd contract && cargo test --quiet)
echo "== verifier (TypeScript)";       node --test packages/verify/src/*.test.ts
echo "== web app (TypeScript)";        pnpm --filter web test
echo "== all offline suites passed"
