#!/bin/bash
# Local validator for tests/omni.test.mjs: the real Meteora DAMM v2 program cloned from mainnet, and the Equo
# Solana leg program at its id with the test wallet as upgrade authority. Add OFT=1 to also load Equo's LayerZero
# OFT program and clone the LayerZero endpoint, ULN and executor programs.
set -e
cd "$(dirname "$0")/.."
export PATH=$HOME/.local/share/solana/install/active_release/bin:$PATH
WALLET=$(solana-keygen pubkey ~/.config/solana/id.json)
EXTRA=()
if [ -n "$OFT" ]; then
  EXTRA+=(--upgradeable-program RuyLPEWoYG2b6mGb6nvKotoNhW2F9KdhrjRghaRdGkz artifacts/oft-v3.so "$WALLET")
  for p in 76y77prsiCMvXMjuoZ5VRrhG5qYBrUMYTE5WgHqgjEn6 7a4WjyR8VZ7yZz5XJAKm39BUGn5iT9CKcv2pmG9tdXVH 6doghB248px58JSSwG4qejQ46kFMW4AMj7vzJnWZHNZn; do
    EXTRA+=(--clone-upgradeable-program "$p")
  done
fi
exec solana-test-validator --reset --quiet --ledger .test-ledger-omni --url https://api.mainnet-beta.solana.com \
  --clone-upgradeable-program cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG \
  --upgradeable-program 8tQmVEDRd4gBXP2brdgKxtmzXbTD3y8uEbY1erS1UFKq target/deploy/equo_omni.so "$WALLET" \
  "${EXTRA[@]}"
