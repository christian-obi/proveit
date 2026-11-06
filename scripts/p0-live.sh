#!/usr/bin/env bash
# P0 live exit tests (T0.2–T0.6) on NEAR testnet + OutLayer testnet.
#
# Prerequisites (done once by hand, see docs/SPIKES.md "Live setup"):
#   - a funded testnet account, key saved in the macOS keychain by NEAR CLI
#   - `outlayer login testnet` done for that account
#
# Usage:  ACCOUNT=you.testnet scripts/p0-live.sh <step>
# Steps, in order:
#   build      build all spike wasm files and the spike contract
#   projects   upload + deploy s1-hello-hl and s2-enclave (v1) to OutLayer testnet
#   contract   create spike.$ACCOUNT and deploy the spike contract to it
#   t02        run S1 on OutLayer and fetch its attestation
#   t03        S2 keys: 2 runs on v1, deploy v2, 1 run on v2, sign + mac runs, then check
#   t04 SECRET store an encrypted secret and check the enclave sees its hash (SECRET = JSON string)
#   t05        S5: 0.9 KB, 4 KB and 16 KB outputs through the callback
#   runs       print every run recorded by the spike contract
#
# Every step appends its raw output to docs/p0-results/<step>.log.

set -euo pipefail

: "${ACCOUNT:?set ACCOUNT=<your account>.testnet}"
NETWORK=testnet
RPC="https://rpc.testnet.fastnear.com"
OUTLAYER_API="https://testnet-api.outlayer.ai"
OUTLAYER_CONTRACT="outlayer.testnet"
SPIKE="spike.$ACCOUNT"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$ROOT/docs/p0-results"
HLP_VAULT="0xdfc24b077bc1425ad1dea75bcb6f8158e10df303"
mkdir -p "$LOG_DIR"

S1_WASM="$ROOT/spikes/s1-hello-hl/target/wasm32-wasip2/release/s1-hello-hl.wasm"
S2_WASM="$ROOT/spikes/s2-enclave/target/wasm32-wasip2/release/s2-enclave.wasm"
S2_WASM_V2="$ROOT/spikes/s2-enclave/target-v2/wasm32-wasip2/release/s2-enclave.wasm"

log() { tee -a "$LOG_DIR/$1.log"; }

# View call on a contract over RPC; prints the decoded JSON result.
rpc_view() {
  local contract=$1 method=$2 args=${3:-'{}'}
  curl -s "$RPC" -H 'Content-Type: application/json' -d "$(python3 -I -c '
import json,sys,base64
print(json.dumps({"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final",
 "account_id":sys.argv[1],"method_name":sys.argv[2],"args_base64":base64.b64encode(sys.argv[3].encode()).decode()}}))' "$contract" "$method" "$args")" |
    python3 -I -c 'import json,sys; r=json.load(sys.stdin)["result"]; print(bytes(r["result"]).decode())'
}

# Start one run through the spike contract and wait for its callback.
spike_run() {
  local input=$1 extra=${2:-}
  local before
  before=$(rpc_view "$SPIKE" get_config | python3 -I -c 'import json,sys; print(json.load(sys.stdin)[2])')
  local args
  args=$(python3 -I -c 'import json,sys; a={"input":sys.argv[1]}; a.update(json.loads(sys.argv[2] or "{}")); print(json.dumps(a))' "$input" "$extra")
  near contract call-function as-transaction "$SPIKE" run json-args "$args" \
    prepaid-gas '300.0 Tgas' attached-deposit '0.05 NEAR' \
    sign-as "$ACCOUNT" network-config "$NETWORK" sign-with-keychain send
  for _ in $(seq 1 60); do
    local run
    run=$(rpc_view "$SPIKE" get_run "{\"id\":$before}")
    if python3 -I -c 'import json,sys; r=json.loads(sys.argv[1]); sys.exit(0 if r and r["finished_block"] else 1)' "$run"; then
      echo "$run"
      return 0
    fi
    sleep 5
  done
  echo "run $before did not finish within 5 minutes" >&2
  return 1
}

fastfs_status() { curl -s -o /dev/null -w '%{http_code}' "$1"; }

# Upload once (skipped if FastFS already serves this exact hash), wait until FastFS
# serves it (indexing lags the upload tx), then deploy with the known hash.
upload_and_deploy() {
  local name=$1 wasm=$2
  local sha url
  sha=$(shasum -a 256 "$wasm" | cut -d' ' -f1)
  url="https://test.fastfs.io/$ACCOUNT/$OUTLAYER_CONTRACT/${sha}.wasm"
  # `outlayer projects` shows the active version as the hash's first 10 characters.
  if outlayer projects 2>/dev/null < /dev/null | awk -v p="$ACCOUNT/$name" -v v="${sha:0:10}" '$1 == p && $2 == v {found=1} END {exit !found}'; then
    echo "already deployed: $ACCOUNT/$name at ${sha:0:10}"
    return 0
  fi
  if [[ "$(fastfs_status "$url")" != "200" ]]; then
    outlayer upload "$wasm"
  else
    echo "already on FastFS: $url"
  fi
  for _ in $(seq 1 36); do
    [[ "$(fastfs_status "$url")" == "200" ]] && break
    echo "waiting for FastFS to serve ${sha}..."
    sleep 5
  done
  [[ "$(fastfs_status "$url")" == "200" ]] || { echo "FastFS still does not serve $url after 3 minutes" >&2; return 1; }
  outlayer deploy "$name" "$url" --hash "$sha"
}

# Every live step signs as $ACCOUNT, so it must be the account the OutLayer CLI is logged in as.
check_account() {
  local who
  who=$(outlayer whoami 2>/dev/null < /dev/null | awk '/^Account:/ {print $2}')
  if [[ "$who" != "$ACCOUNT" ]]; then
    echo "ACCOUNT=$ACCOUNT but the OutLayer CLI is logged in as '${who:-nobody}'. Fix one of them." >&2
    exit 1
  fi
}

case "${1:-}" in build | "") ;; *) check_account ;; esac

case "${1:-}" in
  build)
    (cd "$ROOT/spikes/s1-hello-hl" && cargo build --target wasm32-wasip2 --release)
    (cd "$ROOT/spikes/s2-enclave" && cargo build --target wasm32-wasip2 --release \
      && cargo build --target wasm32-wasip2 --release --features v2 --target-dir target-v2)
    (cd "$ROOT/spikes/s4-leaderboard" && cargo build --target wasm32-wasip2 --release)
    (cd "$ROOT/spikes/s2-contract" && cargo near build non-reproducible-wasm)
    shasum -a 256 "$S1_WASM" "$S2_WASM" "$S2_WASM_V2" | log build
    ;;

  projects)
    { upload_and_deploy s1-hello-hl "$S1_WASM"; upload_and_deploy s2-enclave "$S2_WASM"; } 2>&1 | log projects
    ;;

  contract)
    {
      near account create-account fund-myself "$SPIKE" '3 NEAR' autogenerate-new-keypair --signature-scheme ed25519 save-to-keychain \
        sign-as "$ACCOUNT" network-config "$NETWORK" sign-with-keychain send
      (cd "$ROOT/spikes/s2-contract" && cargo near deploy build-non-reproducible-wasm "$SPIKE" \
        with-init-call new json-args "{\"outlayer\":\"$OUTLAYER_CONTRACT\",\"project_id\":\"$ACCOUNT/s2-enclave\"}" \
        prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' network-config "$NETWORK" sign-with-keychain send)
      rpc_view "$SPIKE" get_config
    } 2>&1 | log contract
    ;;

  t02)
    {
      echo "local sha256: $(shasum -a 256 "$S1_WASM" | cut -d' ' -f1)"
      outlayer run "$ACCOUNT/s1-hello-hl" "{\"user\":\"$HLP_VAULT\"}" --verbose
      echo
      echo "Now fetch the attestation for the run above (task id from the output, or from the dashboard):"
      echo "  curl -s $OUTLAYER_API/attestations/<task_id> | python3 -m json.tool"
      echo "Pass when wasm_hash == local sha256 and output_hash == sha256 of the printed output."
    } 2>&1 | log t02
    ;;

  t03)
    {
      spike_run '{"op":"pubkey"}'
      spike_run '{"op":"pubkey"}'
      spike_run '{"op":"sign","text":"hello from P0"}'
      spike_run '{"op":"mac","data":"hl:0xabc"}'
      echo "== deploying v2 (same code, one constant changed)"
      upload_and_deploy s2-enclave "$S2_WASM_V2"
      spike_run '{"op":"pubkey"}'
      spike_run '{"op":"mac","data":"hl:0xabc"}'
      spike_run '{"op":"env"}'
      rpc_view "$SPIKE" get_runs '{"limit":100}' > "$LOG_DIR/t03-runs.json"
      node "$ROOT/spikes/s2-enclave/check-keys.mjs" "$LOG_DIR/t03-runs.json"
    } 2>&1 | log t03
    ;;

  t04)
    SECRET=${2:?usage: t04 '<secret JSON string>'}
    {
      node "$ROOT/spikes/s3-secrets/encrypt.mjs" --network "$NETWORK" --project "$ACCOUNT/s2-enclave" \
        --owner "$ACCOUNT" --profile s3 --secret "$SECRET"
      echo
      echo "Run the store_secrets command printed above, then:"
      echo "  ACCOUNT=$ACCOUNT scripts/p0-live.sh t04-run"
    } 2>&1 | log t04
    ;;

  t04-run)
    spike_run '{"op":"secret_hash"}' '{"secrets_profile":"s3"}' 2>&1 | log t04
    echo "Pass when sha256_hex equals the 'expected secret_hash' printed by the t04 step." | log t04
    ;;

  t05)
    {
      for bytes in 850 4000 16000; do
        spike_run "{\"op\":\"blob\",\"bytes\":$bytes}"
      done
      echo "Pass when each run has ok=true and output_len close to the requested size; blocks = finished - started."
    } 2>&1 | log t05
    ;;

  runs)
    rpc_view "$SPIKE" get_runs '{"limit":100}' | python3 -m json.tool
    ;;

  *)
    sed -n '2,24p' "$0"
    exit 1
    ;;
esac
