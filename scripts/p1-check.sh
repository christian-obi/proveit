#!/usr/bin/env bash
# P1 exit tests (BUILD_PLAN §5, P1). Runs everything and writes evidence to docs/p1-results/.
#
#   scripts/p1-check.sh            all tests, including T1.9 against the live leaderboard
#   OFFLINE=1 scripts/p1-check.sh  skip T1.9 (no network)
#
# Exits non-zero if any test fails.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/docs/p1-results"
mkdir -p "$OUT"
cd "$ROOT/enclave"

echo "== T1.1–T1.8: cargo test"
cargo test 2>&1 | tee "$OUT/cargo-test.log" | grep -E "^test |test result"

echo "== golden files are in sync with the independent reference (scripts/reference-stats.ts)"
for dir in fixtures/*/; do
  name=$(basename "$dir")
  for days in 30 7 1; do
    file=expected_stats.json; [[ "$days" == 30 ]] || file="expected_stats_${days}d.json"
    if ! diff <(node "$ROOT/scripts/reference-stats.ts" "$dir" --days "$days") "$dir/$file" > /dev/null; then
      echo "  ✘ $name: $file is stale; regenerate with --days $days --write" && exit 1
    fi
  done
  echo "  ✔ $name (30, 7 and 1 days)"
done

echo "== T1.10: wasm binary on fixtures (strict Card parse)"
cargo build -q --target wasm32-wasip2 --release --features fixtures --target-dir target-fixtures
cargo build -q --example check_card
W=target-fixtures/wasm32-wasip2/release/proveit-enclave.wasm
{
  for dir in fixtures/*/; do
    name=$(basename "$dir")
    printf "%-12s " "$name"
    answer=$(echo '{"op":"issue","window_days":30}' | wasmtime run --dir "$dir::/fx" --env PROVEIT_FIXTURE_DIR=/fx "$W")
    expected_status=$(python3 -I -c "import json,sys; print(json.load(open(sys.argv[1]))['status'])" "$dir/expected_stats.json")
    if [[ "$expected_status" == "ok" ]]; then
      echo "$answer" | cargo run -q --example check_card
    else
      echo "refused as expected: $(echo "$answer" | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["code"])')"
    fi
  done
} | tee "$OUT/t1.10-wasm.log"

echo "== live wasm build compiles (reproducible builds with real registries: scripts/p2-check.sh)"
PROVEIT_REGISTRY=ci-compile-check.testnet cargo build -q --target wasm32-wasip2 --release
shasum -a 256 target/wasm32-wasip2/release/proveit-enclave.wasm | tee "$OUT/live-wasm-sha256.txt"

if [[ "${OFFLINE:-0}" != "1" ]]; then
  echo "== T1.9: cross-check against the live leaderboard"
  node "$ROOT/scripts/crosscheck.ts" \
    0xee16198171b3cf5c96af82e538d489f78935fb67 0xcd40e0ef1bb138a6b8894ad5321cceadf4c28115 \
    0x8ce12b7d681d7b3d49086c38e7b852e75a349ec4 0x1f0907e1d620e5e9fc6712bcc4500a696ea2a77a \
    0xb74def0d3efc0bee53634d537f19d363a2f6ee2f | tee "$OUT/t1.9-crosscheck.log"
fi

echo "== P1 checks passed"
