#!/usr/bin/env bash
# P2 live exit tests (T2.7, T2.8) on NEAR testnet + OutLayer testnet.
#
# Usage:  ACCOUNT=you.testnet scripts/p2-live.sh <step>
#   build      reproducible builds of the live and demo-fixture enclaves (enclave/build.sh)
#   deploy     upload + deploy them as projects `enclave` and `enclave-demo`
#   contract   create p2.$ACCOUNT running the spike contract, pointed at $ACCOUNT/enclave
#   t27        pubkey of the live enclave through the contract, twice; must be one key
#   t28        demo enclave: pubkey + issue directly; signature, attestation and wasm hash checked
#
# Logs go to docs/p2-results/<step>.log.

set -euo pipefail

: "${ACCOUNT:?set ACCOUNT=<your account>.testnet}"
NETWORK=testnet
RPC="https://rpc.testnet.fastnear.com"
OUTLAYER_CONTRACT="outlayer.testnet"
CONTRACT="p2.$ACCOUNT"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$ROOT/docs/p2-results"
LIVE_WASM="$ROOT/enclave/dist/proveit-enclave.wasm"
DEMO_WASM="$ROOT/enclave/dist/proveit-enclave-demo-fixture.wasm"
mkdir -p "$LOG_DIR"

log() { tee -a "$LOG_DIR/$1.log"; }

rpc_view() {
  local contract=$1 method=$2 args=${3:-'{}'}
  curl -s "$RPC" -H 'Content-Type: application/json' -d "$(python3 -I -c '
import json,sys,base64
print(json.dumps({"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final",
 "account_id":sys.argv[1],"method_name":sys.argv[2],"args_base64":base64.b64encode(sys.argv[3].encode()).decode()}}))' "$contract" "$method" "$args")" |
    python3 -I -c 'import json,sys; r=json.load(sys.stdin)["result"]; print(bytes(r["result"]).decode())'
}

check_account() {
  local who
  who=$(outlayer whoami 2>/dev/null < /dev/null | awk '/^Account:/ {print $2}')
  [[ "$who" == "$ACCOUNT" ]] || { echo "ACCOUNT=$ACCOUNT but the OutLayer CLI is logged in as '${who:-nobody}'" >&2; exit 1; }
}

fastfs_status() { curl -s -o /dev/null -w '%{http_code}' "$1"; }

upload_and_deploy() {
  local name=$1 wasm=$2 sha url
  sha=$(shasum -a 256 "$wasm" | cut -d' ' -f1)
  url="https://test.fastfs.io/$ACCOUNT/$OUTLAYER_CONTRACT/${sha}.wasm"
  if outlayer projects 2>/dev/null < /dev/null | awk -v p="$ACCOUNT/$name" -v v="${sha:0:10}" '$1 == p && $2 == v {f=1} END {exit !f}'; then
    echo "already deployed: $ACCOUNT/$name at ${sha:0:10}"
    return 0
  fi
  [[ "$(fastfs_status "$url")" == "200" ]] || outlayer upload "$wasm"
  for _ in $(seq 1 36); do
    [[ "$(fastfs_status "$url")" == "200" ]] && break
    echo "waiting for FastFS to serve ${sha}..."
    sleep 5
  done
  outlayer deploy "$name" "$url" --hash "$sha"
}

# One run through the contract; waits for the callback and prints the recorded run.
contract_run() {
  local input=$1 before args run
  before=$(rpc_view "$CONTRACT" get_config | python3 -I -c 'import json,sys; print(json.load(sys.stdin)[2])')
  args=$(python3 -I -c 'import json,sys; print(json.dumps({"input":sys.argv[1]}))' "$input")
  near contract call-function as-transaction "$CONTRACT" run json-args "$args" \
    prepaid-gas '300.0 Tgas' attached-deposit '0.05 NEAR' \
    sign-as "$ACCOUNT" network-config "$NETWORK" sign-with-keychain send > /dev/null
  for _ in $(seq 1 60); do
    run=$(rpc_view "$CONTRACT" get_run "{\"id\":$before}")
    if python3 -I -c 'import json,sys; r=json.loads(sys.argv[1]); sys.exit(0 if r and r["finished_block"] else 1)' "$run"; then
      echo "$run"
      return 0
    fi
    sleep 5
  done
  echo "run $before did not finish within 5 minutes" >&2
  return 1
}

# A direct on-chain run with the OutLayer CLI; prints the transaction hash.
direct_run() {
  local project=$1 input=$2 out
  out=$(outlayer run "$project" "$input" 2>&1 < /dev/null)
  echo "$out" >&2
  echo "$out" | awk '/^Tx:/ {print $2}' | tail -1
}

case "${1:-}" in build | "") ;; *) check_account ;; esac

case "${1:-}" in
  build)
    # P2 ran before builds carried a registry (P3); these builds name the P2 test contract.
    { REGISTRY="$CONTRACT" "$ROOT/enclave/build.sh" live; REGISTRY="$CONTRACT" "$ROOT/enclave/build.sh" demo-fixture; } 2>&1 | log build
    ;;

  deploy)
    { upload_and_deploy enclave "$LIVE_WASM"; upload_and_deploy enclave-demo "$DEMO_WASM"; outlayer projects < /dev/null; } 2>&1 | log deploy
    ;;

  contract)
    {
      near account create-account fund-myself "$CONTRACT" '2 NEAR' autogenerate-new-keypair --signature-scheme ed25519 save-to-keychain \
        sign-as "$ACCOUNT" network-config "$NETWORK" sign-with-keychain send
      (cd "$ROOT/spikes/s2-contract" && cargo near deploy build-non-reproducible-wasm "$CONTRACT" \
        with-init-call new json-args "{\"outlayer\":\"$OUTLAYER_CONTRACT\",\"project_id\":\"$ACCOUNT/enclave\"}" \
        prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' network-config "$NETWORK" sign-with-keychain send)
      rpc_view "$CONTRACT" get_config
    } 2>&1 | log contract
    ;;

  t27)
    {
      a=$(contract_run '{"op":"pubkey"}')
      b=$(contract_run '{"op":"pubkey"}')
      echo "$a"; echo "$b"
      python3 -I - "$a" "$b" <<'EOF'
import json, sys
keys = [json.loads(json.loads(r)["output_head"]).get("pubkey") for r in sys.argv[1:]]
ok = all(k and len(k) == 64 for k in keys) and keys[0] == keys[1]
print(("PASS" if ok else "FAIL") + f": live enclave pubkey through the contract = {keys}")
sys.exit(0 if ok else 1)
EOF
    } 2>&1 | log t27
    ;;

  t28)
    {
      ptx=$(direct_run "$ACCOUNT/enclave-demo" '{"op":"pubkey"}')
      itx=$(direct_run "$ACCOUNT/enclave-demo" '{"op":"issue","window_days":30}')
      echo "pubkey tx $ptx, issue tx $itx"
      pk=$(python3 -I "$ROOT/scripts/lib/outlayer_tx.py" --signer "$ACCOUNT" "$ptx" | python3 -I -c 'import json,sys; print(json.loads(json.load(sys.stdin)["output"])["pubkey"])')
      echo "demo enclave pubkey (direct caller): $pk"
      python3 -I "$ROOT/scripts/lib/outlayer_tx.py" --signer "$ACCOUNT" --wasm "$DEMO_WASM" "$itx" | tee "$LOG_DIR/t28-attestation.json"
      python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["output"])' "$LOG_DIR/t28-attestation.json" |
        (cd "$ROOT/enclave" && cargo run -q --example check_card "$pk")
      echo "PASS: signed card, signature verifies, attestation output and wasm hashes match"
    } 2>&1 | log t28
    ;;

  *)
    sed -n '2,14p' "$0"
    exit 1
    ;;
esac
