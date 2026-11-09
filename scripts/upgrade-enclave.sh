#!/usr/bin/env bash
# Ship a changed enclave everywhere: rebuild all three variants, deploy them to OutLayer on
# testnet and mainnet, approve them on each registry, and record the hashes. Old cards keep
# verifying, because earlier versions stay approved.
#
#   scripts/upgrade-enclave.sh
#
# Needs Docker, and the NEAR and OutLayer CLIs logged in on both networks. Spends a little
# mainnet NEAR from OWNER.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export OWNER="${OWNER:-realist1036.near}"
TESTNET_ACCOUNT="${TESTNET_ACCOUNT:-proveit-realist.testnet}"
NETWORK_FILE="$HOME/.outlayer/default-network"

restore() { echo mainnet > "$NETWORK_FILE"; }
trap restore EXIT

sha() { shasum -a 256 "$1" | cut -d' ' -f1; }

approve() {
  near contract call-function as-transaction "$1" approve_version json-args "{\"hash\":\"$2\"}" \
    prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' sign-as "$TESTNET_ACCOUNT" network-config testnet sign-with-keychain send
}

echo "=== Building the testnet variants"
REGISTRY=proveit-registry.testnet enclave/build.sh live
LIVE=$(sha enclave/dist/proveit-enclave.wasm)
REGISTRY=proveit-demo-registry.testnet enclave/build.sh demo-fixture
DEMO=$(sha enclave/dist/proveit-enclave-demo-fixture.wasm)

echo "=== Deploying to testnet"
echo testnet > "$NETWORK_FILE"
ACCOUNT="$TESTNET_ACCOUNT" scripts/p7-live.sh enclave
approve proveit-registry.testnet "$LIVE"
approve proveit-demo-registry.testnet "$DEMO"
restore

python3 -I - "$LIVE" "$DEMO" <<'EOF'
import re, sys
path = "enclave/expected-hashes.txt"
text = open(path).read()
text = re.sub(r"(?m)^live proveit-registry\.testnet \w+", f"live proveit-registry.testnet {sys.argv[1]}", text)
text = re.sub(r"(?m)^demo-fixture proveit-demo-registry\.testnet \w+", f"demo-fixture proveit-demo-registry.testnet {sys.argv[2]}", text)
open(path, "w").write(text)
EOF

echo "=== Deploying to mainnet"
scripts/deploy-mainnet.sh build
scripts/deploy-mainnet.sh enclave
scripts/deploy-mainnet.sh registry
scripts/deploy-mainnet.sh status

echo "=== Done"
cat enclave/expected-hashes.txt
