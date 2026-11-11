#!/usr/bin/env bash
# Redeploy the registry contract code on all three registries, keeping their state. No
# migration is needed when only methods change. Signs with each registry's own key from the
# keychain, created when the registry was deployed.
#
#   scripts/upgrade-contract.sh

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/contract"

deploy() {
  local account=$1 network=$2
  echo "=== $account ($network)"
  CARGO_RESOLVER_INCOMPATIBLE_RUST_VERSIONS=fallback cargo near deploy build-non-reproducible-wasm "$account" \
    without-init-call network-config "$network" sign-with-keychain send
}

deploy proveit-registry.testnet testnet
deploy proveit-demo-registry.testnet testnet
deploy proveit.near mainnet
echo "=== Done: sales now pay the trader at once"
