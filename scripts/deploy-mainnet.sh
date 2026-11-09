#!/usr/bin/env bash
# P4: deploy Prove-It to NEAR mainnet. Every step checks what's already there and skips it,
# so the whole script can be run again safely (T4.1).
#
#   OWNER=<your>.near scripts/deploy-mainnet.sh <step>
#
#   preflight  check the owner account, its balance, both CLI logins and Docker; changes nothing
#   build      reproducible enclave build for the mainnet registry (updates expected-hashes.txt)
#   enclave    upload + deploy it to OutLayer mainnet as project <owner>/enclave
#   registry   create proveit.near (4 NEAR from the owner), deploy + init the registry,
#              approve the enclave version, bootstrap the enclave key
#   status     print the registry config (T4.2)
#   all        preflight, build, enclave, registry, status
#
# Logs go to docs/p4-results/<step>.log.

set -euo pipefail

: "${OWNER:?set OWNER=<your mainnet account>.near}"
NETWORK=mainnet
RPC="https://rpc.mainnet.fastnear.com"
OUTLAYER_CONTRACT="outlayer.near"
REGISTRY="${REGISTRY:-proveit.near}"
REGISTRY_FUNDING="${REGISTRY_FUNDING:-4 NEAR}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$ROOT/docs/p4-results"
WASM="$ROOT/enclave/dist/proveit-enclave.wasm"
# Circle's native USDC on NEAR mainnet (6 decimals).
USDC="17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"
mkdir -p "$LOG_DIR"

log() { tee -a "$LOG_DIR/$1.log"; }

rpc() {
  curl -s "$RPC" -H 'Content-Type: application/json' -d "$1"
}

account_exists() {
  rpc "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"view_account\",\"finality\":\"final\",\"account_id\":\"$1\"}}" |
    python3 -I -c 'import json,sys; sys.exit(0 if "result" in json.load(sys.stdin) else 1)'
}

balance() {
  rpc "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"view_account\",\"finality\":\"final\",\"account_id\":\"$1\"}}" |
    python3 -I -c 'import json,sys; r=json.load(sys.stdin).get("result"); print("%.3f" % (int(r["amount"])/1e24) if r else "0")'
}

has_code() {
  rpc "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"view_account\",\"finality\":\"final\",\"account_id\":\"$1\"}}" |
    python3 -I -c 'import json,sys; r=json.load(sys.stdin).get("result"); sys.exit(0 if r and r["code_hash"] != "11111111111111111111111111111111" else 1)'
}

rpc_view() {
  local contract=$1 method=$2 args=${3:-'{}'}
  rpc "$(python3 -I -c '
import json,sys,base64
print(json.dumps({"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final",
 "account_id":sys.argv[1],"method_name":sys.argv[2],"args_base64":base64.b64encode(sys.argv[3].encode()).decode()}}))' "$contract" "$method" "$args")" |
    python3 -I -c 'import json,sys; r=json.load(sys.stdin)["result"]; print(bytes(r["result"]).decode())'
}

call() {
  local contract=$1 method=$2 args=$3 deposit=${4:-0 NEAR}
  near contract call-function as-transaction "$contract" "$method" json-args "$args" \
    prepaid-gas '300.0 Tgas' attached-deposit "$deposit" \
    sign-as "$OWNER" network-config "$NETWORK" sign-with-keychain send
}

wait_request() {
  local seq=$1 out
  for _ in $(seq 1 60); do
    out=$(rpc_view "$REGISTRY" get_request "{\"request\":$seq}")
    [[ "$out" != '"Pending"' && "$out" != "null" ]] && { echo "$out"; return 0; }
    sleep 5
  done
  echo "request $seq did not finish within 5 minutes" >&2
  return 1
}

sha() { shasum -a 256 "$WASM" | cut -d' ' -f1; }

outlayer_account() { outlayer whoami 2>/dev/null < /dev/null | awk '/^Account:/ {print $2}'; }
outlayer_network() { outlayer whoami 2>/dev/null < /dev/null | awk '/^Network:/ {print $2}'; }

preflight() {
  local ok=1 bal
  if account_exists "$OWNER"; then
    bal=$(balance "$OWNER")
    echo "✔ owner $OWNER exists, balance $bal NEAR"
    # Only the first deploy needs this much; a re-run skips every step that's already done.
    account_exists "$REGISTRY" || python3 -I -c 'import sys; sys.exit(0 if float(sys.argv[1]) >= 5 else 1)' "$bal" || { echo "✘ need at least 5 NEAR on $OWNER (registry storage ~3 NEAR, uploads and runs ~1 NEAR, margin)"; ok=0; }
  else
    echo "✘ owner $OWNER does not exist on mainnet"; ok=0
  fi
  if account_exists "$REGISTRY"; then
    has_code "$REGISTRY" && echo "✔ $REGISTRY exists with a contract" || echo "• $REGISTRY exists without a contract (the registry step deploys it)"
  else
    echo "• $REGISTRY is free (the registry step creates it with $REGISTRY_FUNDING from $OWNER)"
  fi
  if [[ "$(outlayer_account)" == "$OWNER" && "$(outlayer_network)" == "mainnet" ]]; then
    echo "✔ OutLayer CLI logged in as $OWNER on mainnet"
  else
    echo "✘ OutLayer CLI is '$(outlayer_account)' on '$(outlayer_network)'; run: outlayer login mainnet  (as $OWNER)"; ok=0
  fi
  if near account list-keys "$OWNER" network-config "$NETWORK" now > /dev/null 2>&1; then
    echo "✔ NEAR CLI can read $OWNER (signing uses its key from the keychain)"
  else
    echo "✘ NEAR CLI can't reach $OWNER on mainnet"; ok=0
  fi
  docker info > /dev/null 2>&1 && echo "✔ Docker is running" || { echo "✘ Docker is not running (open Docker Desktop)"; ok=0; }
  [[ "$ok" == 1 ]] && echo "preflight passed" || { echo "preflight failed"; return 1; }
}

build() {
  REGISTRY="$REGISTRY" "$ROOT/enclave/build.sh" live
  local h line
  h=$(sha)
  line="live $REGISTRY $h"
  grep -v "^live $REGISTRY " "$ROOT/enclave/expected-hashes.txt" > "$ROOT/enclave/expected-hashes.txt.tmp" || true
  echo "$line" >> "$ROOT/enclave/expected-hashes.txt.tmp"
  mv "$ROOT/enclave/expected-hashes.txt.tmp" "$ROOT/enclave/expected-hashes.txt"
  echo "recorded: $line"
}

deploy_enclave() {
  [[ "$(outlayer_account)" == "$OWNER" && "$(outlayer_network)" == "mainnet" ]] || { echo "OutLayer CLI must be logged in as $OWNER on mainnet" >&2; return 1; }
  local h out url
  h=$(sha)
  if outlayer projects 2>/dev/null < /dev/null | awk -v p="$OWNER/enclave" -v v="${h:0:10}" '$1 == p && $2 == v {f=1} END {exit !f}'; then
    echo "already deployed: $OWNER/enclave at ${h:0:10}"
    return 0
  fi
  out=$(outlayer upload "$WASM" 2>&1 < /dev/null | tee /dev/stderr)
  url=$(echo "$out" | awk '/^FastFS URL:/ {print $3}' | tail -1)
  [[ -n "$url" ]] || { echo "could not read the FastFS URL from outlayer upload" >&2; return 1; }
  for _ in $(seq 1 36); do
    [[ "$(curl -s -o /dev/null -w '%{http_code}' "$url")" == "200" ]] && break
    echo "waiting for FastFS to serve ${h}..."
    sleep 5
  done
  outlayer deploy enclave "$url" --hash "$h" < /dev/null
}

deploy_registry() {
  local h seq cfg
  h=$(sha)
  if ! account_exists "$REGISTRY"; then
    near account create-account fund-myself "$REGISTRY" "$REGISTRY_FUNDING" autogenerate-new-keypair --signature-scheme ed25519 \
      save-to-keychain sign-as "$OWNER" network-config "$NETWORK" sign-with-keychain send
  fi
  if ! has_code "$REGISTRY"; then
    (cd "$ROOT/contract" && cargo near deploy build-non-reproducible-wasm "$REGISTRY" \
      with-init-call new json-args "{\"owner\":\"$OWNER\",\"outlayer\":\"$OUTLAYER_CONTRACT\",\"project_id\":\"$OWNER/enclave\",\"accept_fixture_cards\":false}" \
      prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' network-config "$NETWORK" sign-with-keychain send)
  else
    echo "registry contract already deployed on $REGISTRY"
  fi
  cfg=$(rpc_view "$REGISTRY" get_config)
  if [[ "$(python3 -I -c 'import json,sys; print(json.loads(sys.argv[1])["active_version"])' "$cfg")" != "$h" ]]; then
    call "$REGISTRY" approve_version "{\"hash\":\"$h\"}"
  else
    echo "version $h already active"
  fi
  cfg=$(rpc_view "$REGISTRY" get_config)
  if [[ "$(python3 -I -c 'import json,sys; print(json.loads(sys.argv[1])["card_pubkey"])' "$cfg")" == "None" ]]; then
    seq=$(python3 -I -c 'import json,sys; print(json.loads(sys.argv[1])["requests"])' "$cfg")
    call "$REGISTRY" bootstrap_key '{}' '0.05 NEAR'
    echo "bootstrap: $(wait_request "$seq")"
  else
    echo "enclave key already set"
  fi
  # P7: viewing keys are paid in Circle's native USDC on NEAR. Without storage_deposit
  # the registry can't receive it (ft_transfer_call to it would fail and refund).
  cfg=$(rpc_view "$REGISTRY" get_config)
  if [[ "$(python3 -I -c 'import json,sys; print(json.loads(sys.argv[1]).get("usdc"))' "$cfg")" != "$USDC" ]]; then
    call "$REGISTRY" set_payments "{\"token\":\"$USDC\",\"fee_bps\":100}"
  else
    echo "payments already set to $USDC"
  fi
  if [[ "$(rpc_view "$USDC" storage_balance_of "{\"account_id\":\"$REGISTRY\"}")" == "null" ]]; then
    call "$USDC" storage_deposit "{\"account_id\":\"$REGISTRY\",\"registration_only\":true}" '0.00125 NEAR'
  else
    echo "$REGISTRY already registered with USDC"
  fi
}

status() {
  local cfg h
  cfg=$(rpc_view "$REGISTRY" get_config)
  h=$(sha)
  echo "$cfg" | python3 -m json.tool
  python3 -I - "$cfg" "$h" <<'EOF'
import json, sys
c, h = json.loads(sys.argv[1]), sys.argv[2]
checks = {
    "active version = reproducible build hash": c["active_version"] == h,
    "enclave key set": bool(c["card_pubkey"]),
    "fixture cards refused": c["accept_fixture_cards"] is False,
    "viewing keys paid in native USDC, 1% fee": c.get("usdc") == "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1" and c.get("fee_bps") == 100,
}
for k, v in checks.items():
    print(("✔ " if v else "✘ ") + k)
sys.exit(0 if all(checks.values()) else 1)
EOF
}

case "${1:-}" in
  preflight) preflight 2>&1 | log preflight ;;
  build) build 2>&1 | log build ;;
  enclave) deploy_enclave 2>&1 | log enclave ;;
  registry) deploy_registry 2>&1 | log registry ;;
  status) status 2>&1 | log status ;;
  all)
    { preflight && build && deploy_enclave && deploy_registry && status; } 2>&1 | log all
    ;;
  *)
    sed -n '2,17p' "$0"
    exit 1
    ;;
esac
