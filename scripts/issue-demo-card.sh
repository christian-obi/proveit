#!/usr/bin/env bash
# P4 (T4.3–T4.6): issue a real card and check it end to end. Works on mainnet or testnet.
#
#   ISSUER=<near account> scripts/issue-demo-card.sh store <proof.json>
#   ISSUER=<near account> scripts/issue-demo-card.sh request <days>     (1, 7, 30, 90 or 180)
#   ISSUER=<near account> scripts/issue-demo-card.sh check <card_id> <request_card tx> <store tx>
#
# proof.json is the PROVEIT_SECRET the web app produces after the Hyperliquid wallet signs:
#   {"venue":"hyperliquid","proof":{"account":"0x…","nearAccount":"<ISSUER>","nonce":…,"expiry":…,"signature":"0x…"}}
# It never leaves this machine unencrypted: `store` encrypts it to the OutLayer keystore.
#
# Defaults: NETWORK=mainnet, REGISTRY=proveit.near, PROJECT_OWNER=$OWNER (who deployed the enclave),
# PROJECT_NAME=enclave.

set -euo pipefail

: "${ISSUER:?set ISSUER=<the NEAR account the proof names>}"
NETWORK="${NETWORK:-mainnet}"
if [[ "$NETWORK" == mainnet ]]; then
  RPC="https://rpc.mainnet.fastnear.com"; REGISTRY="${REGISTRY:-proveit.near}"
else
  RPC="https://rpc.testnet.fastnear.com"; REGISTRY="${REGISTRY:-proveit-registry.testnet}"
fi
PROJECT_OWNER="${PROJECT_OWNER:-${OWNER:-$ISSUER}}"
PROFILE="${PROFILE:-card}"
PROJECT_NAME="${PROJECT_NAME:-enclave}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$ROOT/docs/p4-results"
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

tx_of() { grep -Eo 'Transaction ID: [1-9A-HJ-NP-Za-km-z]+' | awk '{print $3}' | tail -1; }

case "${1:-}" in
  store)
    proof_file=${2:?usage: store <proof.json>}
    {
      secret=$(python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1])); assert d["proof"]["nearAccount"]==sys.argv[2], "the proof names "+d["proof"]["nearAccount"]; print(json.dumps(d))' "$proof_file" "$ISSUER")
      out=$(node "$ROOT/spikes/s3-secrets/encrypt.mjs" --network "$NETWORK" --project "$PROJECT_OWNER/$PROJECT_NAME" \
        --owner "$ISSUER" --profile "$PROFILE" --secret "$secret")
      echo "$out" | grep -v '^near contract'
      store_out=$(eval "$(echo "$out" | grep '^near contract call-function')" 2>&1)
      echo "$store_out" | grep -E "succeeded|Error" || true
      echo "store tx: $(echo "$store_out" | tx_of)"
    } 2>&1 | log store
    ;;

  request)
    days=${2:?usage: request <days>}
    {
      seq=$(rpc_view "$REGISTRY" get_config | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["requests"])')
      out=$(near contract call-function as-transaction "$REGISTRY" request_card \
        json-args "{\"window_days\":$days,\"secrets_profile\":\"$PROFILE\"}" prepaid-gas '300.0 Tgas' attached-deposit '0.07 NEAR' \
        sign-as "$ISSUER" network-config "$NETWORK" sign-with-keychain send 2>&1)
      echo "request_card tx: $(echo "$out" | tx_of)  (request $seq)"
      for _ in $(seq 1 60); do
        r=$(rpc_view "$REGISTRY" get_request "{\"request\":$seq}")
        [[ "$r" != '"Pending"' ]] && break
        sleep 5
      done
      echo "outcome: $r"
    } 2>&1 | log request
    ;;

  check)
    id=${2:?usage: check <card_id> <request_card tx> <store tx>}
    req_tx=${3:?request_card tx}
    store_tx=${4:?store tx}
    {
      card=$(rpc_view "$REGISTRY" get_card "{\"card_id\":$id}")
      json=$(python3 -I -c 'import json,sys; print(json.loads(sys.argv[1])["card_json"])' "$card")
      echo "== T4.3 verify_card: $(rpc_view "$REGISTRY" verify_card "{\"card_id\":$id}" | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["status"])')"

      echo "== T4.4 attestation"
      version=$(python3 -I -c 'import json,sys; print(json.loads(sys.argv[1])["version"])' "$card")
      python3 -I "$ROOT/scripts/lib/outlayer_tx.py" --network "$NETWORK" --signer "$ISSUER" "$req_tx" > "$LOG_DIR/card-$id-attestation.json" || true
      python3 -I - "$LOG_DIR/card-$id-attestation.json" "$version" "$REGISTRY" "$PROJECT_OWNER/$PROJECT_NAME" <<'EOF'
import json, sys
a = json.load(open(sys.argv[1]))
att, version, registry, project = a["attestation"], sys.argv[2], sys.argv[3], sys.argv[4]
checks = {
    "output_hash = sha256(output returned on-chain)": a["checks"]["output_hash matches"],
    "wasm_hash = the version the registry pinned": att["wasm_hash"] == version == att["executed_wasm_sha256"],
    "project is the registry's enclave project": att["project_id"] == project,
}
for k, v in checks.items():
    print(("  ✔ " if v else "  ✘ ") + k)
sys.exit(0 if all(checks.values()) else 1)
EOF

      echo "== T4.5 leak check"
      address=$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["proof"]["account"])' "${PROOF_FILE:?set PROOF_FILE to the proof.json used for store}")
      hash=$(python3 -I -c 'import json,sys; print(json.loads(sys.argv[1])["card_hash"])' "$card")
      python3 -I "$ROOT/scripts/leakcheck.py" --network "$NETWORK" --signer "$ISSUER" --needle "$address" --control "$hash" "$store_tx" "$req_tx"

      echo "== T4.6 card fields"
      python3 -I - "$json" "$address" <<'EOF'
import json, re, sys
card, address = json.loads(sys.argv[1]), sys.argv[2].lower()
text = json.dumps(card).lower()
checks = {
    "no address": address[2:] not in text,
    "no transaction hash (0x + 64 hex)": not re.search(r"0x[0-9a-f]{64}", text),
    "no order or trade ids": not any(k in text for k in ('"oid"', '"tid"', '"hash"')),
    "volume is a band, not exact": re.fullmatch(r"1e\d+", card["stats"]["volume_band"]) is not None,
    "no account value field": "account_value" not in text and "equity" not in text,
}
for k, v in checks.items():
    print(("  ✔ " if v else "  ✘ ") + k)
sys.exit(0 if all(checks.values()) else 1)
EOF
    } 2>&1 | log "check-$id"
    ;;

  *)
    sed -n '2,15p' "$0"
    exit 1
    ;;
esac
