#!/usr/bin/env bash
# Reproducible build of the enclave. Anyone can run this and compare the printed sha256
# with the version the registry approved and the `wasm_hash` in any card's attestation.
#
#   enclave/build.sh                 live build      → enclave/dist/proveit-enclave.wasm
#   enclave/build.sh demo-fixture    testnet smoke   → enclave/dist/proveit-enclave-demo-fixture.wasm
#
# Everything that affects the bytes is pinned: the Rust image (by digest), Cargo.lock
# (--locked), the build path inside the container, and the path prefixes rustc embeds.

set -euo pipefail

IMAGE="rust:1.98.0-slim-bookworm@sha256:1469a27c125cb5a3aebfa4f4e4665d935b02fb72cc093b2c974b3d740e43f157"
VARIANT="${1:-live}"
case "$VARIANT" in
  live) FEATURES=""; NAME="proveit-enclave.wasm" ;;
  demo-fixture) FEATURES="--features demo-fixture"; NAME="proveit-enclave-demo-fixture.wasm" ;;
  *) echo "usage: $0 [live|demo-fixture]" >&2; exit 1 ;;
esac

HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$HERE/dist"

# The source is mounted read-only and copied to a fixed path, so the result can't depend
# on where the repository lives or on anything left in a local target/ directory.
docker run --rm --platform "${PLATFORM:-linux/amd64}" \
  -v "$HERE":/src:ro \
  -v "$HERE/dist":/out \
  -v proveit-cargo-registry:/usr/local/cargo/registry \
  -e SOURCE_DATE_EPOCH=0 \
  -e CARGO_INCREMENTAL=0 \
  -e RUSTFLAGS="--remap-path-prefix=/build=/enclave --remap-path-prefix=/usr/local/cargo=/cargo" \
  "$IMAGE" bash -euo pipefail -c "
    rustup target add wasm32-wasip2 >/dev/null 2>&1
    mkdir /build
    cd /src && tar --exclude=./target --exclude=./target-* --exclude=./dist -cf - . | (cd /build && tar -xf -)
    cd /build
    cargo build --locked --release --target wasm32-wasip2 $FEATURES 2>&1 | tail -1
    cp target/wasm32-wasip2/release/proveit-enclave.wasm /out/$NAME
  "

SHA=$(shasum -a 256 "$HERE/dist/$NAME" | cut -d' ' -f1)
echo "$SHA  dist/$NAME"
