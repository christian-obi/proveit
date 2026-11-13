#!/usr/bin/env bash
# P7 live on NEAR testnet + OutLayer testnet: viewing keys paid in (test) USDC, and a reveal
# the follower decrypts and Merkle-checks on their own machine.
#
#   ACCOUNT=proveit-realist.testnet scripts/p7-live.sh <step>
#
#   accounts   create the test token and follower accounts with the testnet faucet
#   token      deploy tUSDC (contract/mock-usdc, 6 decimals), register the registries and
#              accounts with it, give the follower 20 tUSDC
#   enclave    deploy the P7 enclave builds (enclave/dist, from enclave/build.sh) to OutLayer
#   registry   upgrade both registries in place (migrate keeps every card), approve the new
#              builds, set tUSDC as the payment token at a 1% fee
#   card       a new demo card from the P7 build (it keeps its orders for reveals)
#   offer      sell keys for it: 1 tUSDC, 1-hour delay, 30 days, 5 seats
#   buy        the follower underpays (refunded, no key), then pays exactly (key granted)
#   reveal     the follower reveals with a fresh X25519 key, decrypts and checks the trades
#   leak       neither the payment nor the reveal transactions contain the account's address
#              or any plaintext trade
#   all        every step in order
#
# Logs go to docs/p7-results/<step>.log; state between steps in docs/p7-results/state.txt.

set -euo pipefail

: "${ACCOUNT:?set ACCOUNT=<your account>.testnet}"
NETWORK=testnet
RPC="https://rpc.testnet.fastnear.com"
OUTLAYER_CONTRACT="outlayer.testnet"
DEMO_REGISTRY="proveit-demo-registry.testnet"
LIVE_REGISTRY="proveit-registry.testnet"
TOKEN="${TOKEN:-proveit-usdc.testnet}"
FOLLOWER="${FOLLOWER:-proveit-follower.testnet}"
# The public account the demo build's fixture was recorded from (enclave/fixtures/winner).
DEMO_ADDRESS="0xe986b8e58b5870dca58700c23b5303f20f6823a7"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$ROOT/docs/p7-results"
STATE="$LOG_DIR/state.txt"
LIVE_WASM="$ROOT/enclave/dist/proveit-enclave.wasm"
DEMO_WASM="$ROOT/enclave/dist/proveit-enclave-demo-fixture.wasm"
REGISTRY_WASM="$ROOT/contract/target/near/proveit_registry.wasm"
TOKEN_WASM="$ROOT/contract/mock-usdc/target/near/proveit_mock_usdc.wasm"
mkdir -p "$LOG_DIR"
touch "$STATE"
# shellcheck disable=SC1090
source "$STATE"

log() { tee -a "$LOG_DIR/$1.log"; }
save() { grep -v "^$1=" "$STATE" > "$STATE.tmp" || true; echo "$1=$2" >> "$STATE.tmp"; mv "$STATE.tmp" "$STATE"; export "$1=$2"; }

# A view call; retried, because public RPCs rate-limit.
rpc_view() {
  local contract=$1 method=$2 args=${3:-'{}'} body out
  body=$(python3 -I -c '
import json,sys,base64
print(json.dumps({"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final",
 "account_id":sys.argv[1],"method_name":sys.argv[2],"args_base64":base64.b64encode(sys.argv[3].encode()).decode()}}))' "$contract" "$method" "$args")
  for i in 1 2 3 4 5; do
    out=$(curl -s "$RPC" -H 'Content-Type: application/json' -d "$body" |
      python3 -I -c 'import json,sys; r=json.load(sys.stdin)["result"]; print(bytes(r["result"]).decode())' 2>/dev/null) && { echo "$out"; return 0; }
    sleep $((i * 2))
  done
  echo "view $contract.$method failed" >&2
  return 1
}

# A function call signed by $3 (default $ACCOUNT); prints the transaction hash.
call_as() {
  local signer=$1 contract=$2 method=$3 args=$4 deposit=${5:-0 NEAR} out
  out=$(near contract call-function as-transaction "$contract" "$method" json-args "$args" \
    prepaid-gas '300.0 Tgas' attached-deposit "$deposit" \
    sign-as "$signer" network-config "$NETWORK" sign-with-keychain send 2>&1 < /dev/null)
  echo "$out" >&2
  echo "$out" | grep -Eo 'Transaction ID: [1-9A-HJ-NP-Za-km-z]+' | awk '{print $3}' | tail -1
}
call() { call_as "$ACCOUNT" "$@"; }

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
sha_of() { shasum -a 256 "$1" | cut -d' ' -f1; }
exists() { [[ "$(curl -s "$RPC" -H 'Content-Type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"view_account\",\"finality\":\"final\",\"account_id\":\"$1\"}}" | grep -c '"amount"')" == 1 ]]; }
has_code() { curl -s "$RPC" -H 'Content-Type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"view_account\",\"finality\":\"final\",\"account_id\":\"$1\"}}" | grep -vq '"code_hash":"11111111111111111111111111111111"'; }
fastfs_status() { curl -s -o /dev/null -w '%{http_code}' "$1"; }

check_account() {
  local who
  who=$(outlayer whoami 2>/dev/null < /dev/null | awk '/^Account:/ {print $2}')
  [[ "$who" == "$ACCOUNT" ]] || { echo "ACCOUNT=$ACCOUNT but the OutLayer CLI is logged in as '${who:-nobody}'" >&2; exit 1; }
}

upload_and_deploy() {
  local name=$1 wasm=$2 sha url
  sha=$(sha_of "$wasm")
  url="https://test.fastfs.io/$ACCOUNT/$OUTLAYER_CONTRACT/${sha}.wasm"
  if outlayer projects 2>/dev/null < /dev/null | awk -v p="$ACCOUNT/$name" -v v="${sha:0:10}" '$1 == p && $2 == v {f=1} END {exit !f}'; then
    echo "already deployed: $ACCOUNT/$name at ${sha:0:10}"
    return 0
  fi
  [[ "$(fastfs_status "$url")" == "200" ]] || outlayer upload "$wasm" < /dev/null
  for _ in $(seq 1 36); do
    [[ "$(fastfs_status "$url")" == "200" ]] && break
    echo "waiting for FastFS to serve ${sha}..."
    sleep 5
  done
  outlayer deploy "$name" "$url" --hash "$sha" < /dev/null
}

step_accounts() {
  for a in "$TOKEN" "$FOLLOWER"; do
    if exists "$a"; then
      echo "already exists: $a"
    else
      near account create-account sponsor-by-faucet-service "$a" autogenerate-new-keypair --signature-scheme ed25519 \
        save-to-keychain network-config "$NETWORK" create < /dev/null
    fi
  done
}

step_token() {
  if has_code "$TOKEN"; then
    echo "tUSDC already deployed on $TOKEN"
  else
    (cd "$ROOT/contract/mock-usdc" && CARGO_RESOLVER_INCOMPATIBLE_RUST_VERSIONS=fallback cargo near build non-reproducible-wasm)
    near contract deploy "$TOKEN" use-file "$TOKEN_WASM" with-init-call new \
      json-args "{\"owner_id\":\"$ACCOUNT\",\"total_supply\":\"1000000000000\"}" \
      prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' network-config "$NETWORK" sign-with-keychain send < /dev/null
  fi
  for a in "$DEMO_REGISTRY" "$LIVE_REGISTRY" "$FOLLOWER" "$ACCOUNT"; do
    if [[ "$(rpc_view "$TOKEN" storage_balance_of "{\"account_id\":\"$a\"}")" == "null" ]]; then
      call "$TOKEN" storage_deposit "{\"account_id\":\"$a\",\"registration_only\":true}" '0.00125 NEAR' > /dev/null
      echo "registered $a with $TOKEN"
    fi
  done
  if [[ "$(rpc_view "$TOKEN" ft_balance_of "{\"account_id\":\"$FOLLOWER\"}")" == '"0"' ]]; then
    call "$TOKEN" ft_transfer "{\"receiver_id\":\"$FOLLOWER\",\"amount\":\"20000000\"}" '1 yoctoNEAR' > /dev/null
  fi
  echo "follower balance: $(rpc_view "$TOKEN" ft_balance_of "{\"account_id\":\"$FOLLOWER\"}") (6 decimals)"
}

step_enclave() {
  upload_and_deploy enclave "$LIVE_WASM"
  upload_and_deploy enclave-demo "$DEMO_WASM"
  outlayer projects < /dev/null
}

step_registry() {
  (cd "$ROOT/contract" && CARGO_RESOLVER_INCOMPATIBLE_RUST_VERSIONS=fallback cargo near build non-reproducible-wasm)
  for pair in "$DEMO_REGISTRY:$DEMO_WASM" "$LIVE_REGISTRY:$LIVE_WASM"; do
    IFS=: read -r registry wasm <<< "$pair"
    echo "== $registry"
    if rpc_view "$registry" get_config | grep -q '"fee_bps"'; then
      echo "already upgraded; redeploying the code without migrating"
      near contract deploy "$registry" use-file "$REGISTRY_WASM" without-init-call network-config "$NETWORK" sign-with-keychain send < /dev/null
    else
      near contract deploy "$registry" use-file "$REGISTRY_WASM" with-init-call migrate json-args '{}' \
        prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' network-config "$NETWORK" sign-with-keychain send < /dev/null
    fi
    call "$registry" approve_version "{\"hash\":\"$(sha_of "$wasm")\"}" > /dev/null
    call "$registry" set_payments "{\"token\":\"$TOKEN\",\"fee_bps\":100}" > /dev/null
    rpc_view "$registry" get_config
    echo "card #0 still verifies: $(rpc_view "$registry" verify_card '{"card_id":0}')"
  done
}

step_card() {
  local seq tx outcome id
  seq=$(next_request "$DEMO_REGISTRY")
  tx=$(call "$DEMO_REGISTRY" request_card '{"window_days":30}' '0.07 NEAR')
  outcome=$(wait_request "$DEMO_REGISTRY" "$seq")
  echo "request $seq tx $tx → $outcome"
  id=$(python3 -I -c 'import json,sys; print(json.loads(sys.argv[1])["Issued"]["card_id"])' "$outcome")
  save CARD_ID "$id"
  echo "verify_card($id) = $(rpc_view "$DEMO_REGISTRY" verify_card "{\"card_id\":$id}")"
}

step_offer() {
  : "${CARD_ID:?run the card step first}"
  call "$DEMO_REGISTRY" set_offer "{\"card_id\":$CARD_ID,\"price\":\"1000000\",\"delay_secs\":3600,\"duration_secs\":2592000,\"max_seats\":5,\"requires_approval\":false}" > /dev/null
  echo "get_offer = $(rpc_view "$DEMO_REGISTRY" get_offer "{\"card_id\":$CARD_ID}")"
}

balance_of() { rpc_view "$TOKEN" ft_balance_of "{\"account_id\":\"$1\"}" | tr -d '"'; }

step_buy() {
  : "${CARD_ID:?run the card step first}"
  local before after tx
  before=$(balance_of "$FOLLOWER")
  tx=$(call_as "$FOLLOWER" "$TOKEN" ft_transfer_call "{\"receiver_id\":\"$DEMO_REGISTRY\",\"amount\":\"500000\",\"msg\":\"{\\\"card_id\\\":$CARD_ID}\"}" '1 yoctoNEAR')
  after=$(balance_of "$FOLLOWER")
  echo "underpaid 0.5 tUSDC (tx $tx): balance $before → $after, grant = $(rpc_view "$DEMO_REGISTRY" get_grant "{\"card_id\":$CARD_ID,\"buyer\":\"$FOLLOWER\"}")"
  [[ "$before" == "$after" ]] && echo "PASS: refunded in full, no key" || { echo "FAIL: underpayment not refunded"; exit 1; }

  local issuer_before
  issuer_before=$(rpc_view "$DEMO_REGISTRY" get_balance "{\"account\":\"$ACCOUNT\"}" | tr -d '"')
  tx=$(call_as "$FOLLOWER" "$TOKEN" ft_transfer_call "{\"receiver_id\":\"$DEMO_REGISTRY\",\"amount\":\"1000000\",\"msg\":\"{\\\"card_id\\\":$CARD_ID}\"}" '1 yoctoNEAR')
  save BUY_TX "$tx"
  echo "paid 1 tUSDC (tx $tx): balance $(balance_of "$FOLLOWER")"
  echo "grant = $(rpc_view "$DEMO_REGISTRY" get_grant "{\"card_id\":$CARD_ID,\"buyer\":\"$FOLLOWER\"}")"
  echo "issuer balance in the registry: $issuer_before → $(rpc_view "$DEMO_REGISTRY" get_balance "{\"account\":\"$ACCOUNT\"}") (owner = issuer here, so it gets the fee too)"
  echo "get_offer = $(rpc_view "$DEMO_REGISTRY" get_offer "{\"card_id\":$CARD_ID}")"
}

step_reveal() {
  : "${CARD_ID:?run the card step first}"
  local keys secret pub tx
  # A throwaway key for this run. It decrypts only this reveal, of a recorded public
  # account's trades; it's kept so the browser test can replay the real reveal.
  keys=$(node "$ROOT/scripts/open-reveal.ts" keygen)
  read -r secret pub <<< "$keys"
  tx=$(call_as "$FOLLOWER" "$DEMO_REGISTRY" request_reveal "{\"card_id\":$CARD_ID,\"x25519_pub\":\"$pub\"}" '0.05 NEAR')
  save REVEAL_TX "$tx"
  echo "request_reveal tx $tx"
  node "$ROOT/scripts/open-reveal.ts" --registry "$DEMO_REGISTRY" --card "$CARD_ID" --tx "$tx" --sender "$FOLLOWER" --secret "$secret" \
    --record "$ROOT/web/e2e/fixtures/reveal.json"
}

step_leak() {
  : "${BUY_TX:?run the buy step first}" "${REVEAL_TX:?run the reveal step first}"
  echo "== the fixture account's address"
  python3 -I "$ROOT/scripts/leakcheck.py" --network "$NETWORK" --signer "$FOLLOWER" --needle "$DEMO_ADDRESS" --control viewing_key_granted "$BUY_TX"
  python3 -I "$ROOT/scripts/leakcheck.py" --network "$NETWORK" --signer "$FOLLOWER" --needle "$DEMO_ADDRESS" --control Revealed "$REVEAL_TX"
  echo "== plaintext trades (every record has a \"dir\" such as \"Open Long\")"
  for needle in "Open Long" "Close Long" "size_bps"; do
    python3 -I "$ROOT/scripts/leakcheck.py" --network "$NETWORK" --signer "$FOLLOWER" --needle "$needle" --control ciphertext "$REVEAL_TX"
  done
}

case "${1:-}" in accounts | token | "") ;; *) check_account ;; esac

case "${1:-}" in
  accounts | token | enclave | registry | card | offer | buy | reveal | leak) "step_$1" 2>&1 | log "$1" ;;
  all) for s in accounts token enclave registry card offer buy reveal leak; do echo "######## $s"; "step_$s" 2>&1 | log "$s"; done ;;
  *)
    sed -n '2,22p' "$0"
    exit 1
    ;;
esac
