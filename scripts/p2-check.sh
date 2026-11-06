#!/usr/bin/env bash
# P2 exit tests that run without a network or wallet (BUILD_PLAN §5, P2). The cargo tests
# for T2.1–T2.4 run in scripts/p1-check.sh; this adds the cross-language and build checks.
#
#   scripts/p2-check.sh              everything, including two reproducible builds (~6 min)
#   SKIP_BUILD=1 scripts/p2-check.sh skip T2.5/T2.6
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "== test vectors are in sync with packages/verify (regenerate and diff)"
tmp=$(mktemp -d)
cp test-vectors/merkle.json test-vectors/card-sig.json "$tmp/"
node scripts/gen-p2-vectors.ts > /dev/null
for f in merkle.json card-sig.json; do
  if ! diff -q "$tmp/$f" "test-vectors/$f" > /dev/null; then
    cp "$tmp/$f" "test-vectors/$f"
    echo "  ✘ test-vectors/$f is stale; run node scripts/gen-p2-vectors.ts and commit" && exit 1
  fi
  echo "  ✔ $f"
done

echo "== packages/verify: TypeScript verifier accepts Rust-signed cards"
node --test packages/verify/src/*.test.ts 2>&1 | grep -E "^ℹ (pass|fail|skipped)"

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  echo "== T2.5/T2.6: reproducible builds match enclave/expected-hashes.txt"
  enclave/build.sh live | tail -1
  enclave/build.sh demo-fixture | tail -1
  (cd enclave && grep -v '^#' expected-hashes.txt | shasum -a 256 -c -)
  for w in enclave/dist/*.wasm; do
    n=$(wasm-tools print "$w" | grep -c 'outlayer.manifest' || true)
    [[ "$n" -ge 1 ]] || { echo "  ✘ $w has no outlayer.manifest section"; exit 1; }
    echo "  ✔ manifest embedded: $w"
  done
fi
echo "== P2 offline checks passed"
