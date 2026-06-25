#!/usr/bin/env bash
# Fetches the Solidity dependencies (kept out of git). Run once after cloning.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p lib

if [ ! -f lib/forge-std/src/Test.sol ]; then
  echo "fetching forge-std..."
  curl -sSL -o /tmp/forge-std.tar.gz https://codeload.github.com/foundry-rs/forge-std/tar.gz/refs/tags/v1.9.6
  rm -rf lib/forge-std && tar -xzf /tmp/forge-std.tar.gz -C lib && mv lib/forge-std-1.9.6 lib/forge-std
fi

if [ ! -f lib/base-std/src/StdPrecompiles.sol ]; then
  echo "fetching base-std (Base's official B20 library)..."
  curl -sSL -o /tmp/base-std.tar.gz https://codeload.github.com/base/base-std/tar.gz/refs/heads/main
  rm -rf lib/base-std && tar -xzf /tmp/base-std.tar.gz -C lib && mv lib/base-std-main lib/base-std
fi

echo "deps ready. run: forge test"
