#!/usr/bin/env bash
# Builds both contracts for wasm32 and shrinks them with wasm-opt into out/.
set -euo pipefail
cd "$(dirname "$0")"
cargo build --release --target wasm32-unknown-unknown -p launch-token -p launch-factory
mkdir -p out
for f in launch_token launch_factory; do
  wasm-opt -Oz --strip-debug --strip-producers -o "out/$f.wasm" "target/wasm32-unknown-unknown/release/$f.wasm"
  printf '%s: %s bytes -> %s bytes\n' "$f" "$(stat -c%s "target/wasm32-unknown-unknown/release/$f.wasm")" "$(stat -c%s "out/$f.wasm")"
done
sha256sum out/*.wasm
