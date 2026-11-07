#!/usr/bin/env bash
# P3 live tests on NEAR testnet + OutLayer testnet: two registries, the enclave builds for
# them, and the full request → enclave → callback → verify path.
#
#   ACCOUNT=you.testnet scripts/e2e-testnet.sh <step>
#
#   accounts   create the two registry accounts with the testnet faucet
#   build      reproducible enclave builds for each registry (updates expected-hashes.txt)
#   enclave    deploy them: live → project `enclave`, demo → project `enclave-demo`
#   registry   deploy + init both registries, approve the enclave versions, bootstrap the keys
#   demo       demo registry: a 30-day and a 7-day card, then verify_card on each
#   live       live registry with a test-key ownership proof: accepted signature, then a
#              TOO_FEW_TRADES refusal with the storage fee refunded (the real-wallet card is T3.6)
#   door       call the live enclave directly, not through the registry: must be refused
#
# Logs go to docs/p3-results/<step>.log.

set -euo pipefail

: "${ACCOUNT:?set ACCOUNT=<your account>.testnet}"
NETWORK=testnet
RPC="https://rpc.testnet.fastnear.com"
OUTLAYER_CONTRACT="outlayer.testnet"
DEMO_REGISTRY="proveit-demo-registry.testnet"
LIVE_REGISTRY="proveit-registry.testnet"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$ROOT/docs/p3-results"
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

# A function call signed by $ACCOUNT; prints the transaction hash.
call() {
  local contract=$1 method=$2 args=$3 deposit=${4:-0 NEAR} out
  out=$(near contract call-function as-transaction "$contract" "$method" json-args "$args" \
    prepaid-gas '300.0 Tgas' attached-deposit "$deposit" \
    sign-as "$ACCOUNT" network-config "$NETWORK" sign-with-keychain send 2>&1)
  echo "$out" >&2
  echo "$out" | grep -Eo 'Transaction ID: [1-9A-HJ-NP-Za-km-z]+' | awk '{print $3}' | tail -1
}

# Wait until a registry request leaves Pending; prints its outcome.
wait_request() {
  local registry=$1 seq=$2 out
  for _ in $(seq 1 60); do
    out=$(rpc_view "$registry" get_request "{\"request\":$seq}")
    [[ "$out" != '"Pending"' && "$out" != "null" ]] && { echo "$out"; return 0; }
    sleep 5
  done
  echo "request $seq on $registry did not finish within 5 minutes" >&2
  return 1
}

next_request() { rpc_view "$1" get_config | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["requests"])'; }

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

sha_of() { shasum -a 256 "$1" | cut -d' ' -f1; }

case "${1:-}" in accounts | build | "") ;; *) check_account ;; esac

case "${1:-}" in
  accounts)
    for a in "$DEMO_REGISTRY" "$LIVE_REGISTRY"; do
      near account create-account sponsor-by-faucet-service "$a" autogenerate-new-keypair --signature-scheme ed25519 \
        save-to-keychain network-config "$NETWORK" create
    done 2>&1 | log accounts
    ;;

  build)
    {
      REGISTRY="$LIVE_REGISTRY" "$ROOT/enclave/build.sh" live
      REGISTRY="$DEMO_REGISTRY" "$ROOT/enclave/build.sh" demo-fixture
      cat > "$ROOT/enclave/expected-hashes.txt" <<EOF
# Reproducible builds (enclave/build.sh, linux/amd64). CI rebuilds each line and compares.
# After changing enclave code, rebuild and update.  Format: <variant> <registry> <sha256>
live $LIVE_REGISTRY $(sha_of "$LIVE_WASM")
demo-fixture $DEMO_REGISTRY $(sha_of "$DEMO_WASM")
EOF
      cat "$ROOT/enclave/expected-hashes.txt"
    } 2>&1 | log build
    ;;

  enclave)
    { upload_and_deploy enclave "$LIVE_WASM"; upload_and_deploy enclave-demo "$DEMO_WASM"; outlayer projects < /dev/null; } 2>&1 | log enclave
    ;;

  registry)
    {
      for pair in "$DEMO_REGISTRY:enclave-demo:true:$DEMO_WASM" "$LIVE_REGISTRY:enclave:false:$LIVE_WASM"; do
        IFS=: read -r registry project fixtures wasm <<< "$pair"
        echo "== $registry → $ACCOUNT/$project (accept_fixture_cards=$fixtures)"
        (cd "$ROOT/contract" && cargo near deploy build-non-reproducible-wasm "$registry" \
          with-init-call new json-args "{\"owner\":\"$ACCOUNT\",\"outlayer\":\"$OUTLAYER_CONTRACT\",\"project_id\":\"$ACCOUNT/$project\",\"accept_fixture_cards\":$fixtures}" \
          prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' network-config "$NETWORK" sign-with-keychain send)
        call "$registry" approve_version "{\"hash\":\"$(sha_of "$wasm")\"}" > /dev/null
        seq=$(next_request "$registry")
        call "$registry" bootstrap_key '{}' '0.05 NEAR' > /dev/null
        echo "bootstrap: $(wait_request "$registry" "$seq")"
        rpc_view "$registry" get_config
      done
    } 2>&1 | log registry
    ;;

  demo)
    {
      for days in 30 7; do
        seq=$(next_request "$DEMO_REGISTRY")
        tx=$(call "$DEMO_REGISTRY" request_card "{\"window_days\":$days}" '0.07 NEAR')
        outcome=$(wait_request "$DEMO_REGISTRY" "$seq")
        echo "== ${days}-day card: request $seq tx $tx → $outcome"
        id=$(python3 -I -c 'import json,sys; o=json.loads(sys.argv[1]); print(o["Issued"]["card_id"] if "Issued" in o else "")' "$outcome")
        if [[ -n "$id" ]]; then
          card=$(rpc_view "$DEMO_REGISTRY" get_card "{\"card_id\":$id}")
          json=$(python3 -I -c 'import json,sys; print(json.loads(sys.argv[1])["card_json"])' "$card")
          echo "verify_card($id) = $(rpc_view "$DEMO_REGISTRY" verify_card "{\"card_id\":$id}")"
          args=$(python3 -I -c 'import json,sys; print(json.dumps({"card_id": int(sys.argv[1]), "card_json": sys.argv[2]}))' "$id" "$json")
          echo "verify_card($id, exact json) = $(rpc_view "$DEMO_REGISTRY" verify_card "$args")"
          edited=$(python3 -I -c 'import json,sys; c=json.loads(sys.argv[2]); c["stats"]["return_bps"]+=2000; print(json.dumps({"card_id": int(sys.argv[1]), "card_json": json.dumps(c)}))' "$id" "$json")
          echo "verify_card($id, return +20pp) = $(rpc_view "$DEMO_REGISTRY" verify_card "$edited")"
        fi
      done
    } 2>&1 | log demo
    ;;

  live)
    {
      secret=$(node "$ROOT/scripts/sign-test-ownership.ts" "$ACCOUNT")
      node "$ROOT/spikes/s3-secrets/encrypt.mjs" --network "$NETWORK" --project "$ACCOUNT/enclave" \
        --owner "$ACCOUNT" --profile p3live --secret "$(python3 -I -c 'import json,sys; print(json.dumps(json.loads(sys.argv[1])))' "$secret")" \
        > "$LOG_DIR/live-store.txt"
      # encrypt.mjs encrypts PROVEIT_SECRET's value: the whole {"venue","proof"} object.
      store_cmd=$(grep '^near contract call-function' "$LOG_DIR/live-store.txt")
      echo "storing the encrypted secret"
      store_out=$(eval "$store_cmd" 2>&1)
      store_tx=$(echo "$store_out" | grep -Eo 'Transaction ID: [1-9A-HJ-NP-Za-km-z]+' | awk '{print $3}' | tail -1)
      echo "$store_out" | grep -E "succeeded|Error" || true
      seq=$(next_request "$LIVE_REGISTRY")
      tx=$(call "$LIVE_REGISTRY" request_card '{"window_days":30,"secrets_profile":"p3live"}' '0.07 NEAR')
      echo "== live request $seq tx $tx → $(wait_request "$LIVE_REGISTRY" "$seq")"
      echo "expected: TOO_FEW_TRADES (the test key's account never traded), with the 0.02 NEAR storage fee refunded"
      address=$(python3 -I -c 'import json,sys; print(json.loads(sys.argv[1])["proof"]["account"])' "$secret")
      echo "== leak check: store_secrets $store_tx, request_card $tx"
      python3 -I "$ROOT/scripts/leakcheck.py" --signer "$ACCOUNT" --needle "$address" --control TOO_FEW_TRADES "$store_tx" "$tx"
    } 2>&1 | log live
    ;;

  door)
    {
      out=$(outlayer run "$ACCOUNT/enclave" '{"op":"pubkey"}' 2>&1 < /dev/null)
      echo "$out"
      echo "$out" | grep -q "only the registry" && echo "PASS: a direct call to the live enclave is refused" || { echo "FAIL"; exit 1; }
    } 2>&1 | log door
    ;;

  *)
    sed -n '2,20p' "$0"
    exit 1
    ;;
esac
