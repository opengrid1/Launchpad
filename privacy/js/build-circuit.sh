#!/usr/bin/env bash
# Compile the withdraw circuit and run a Groth16 trusted setup, then export the
# Solidity verifier. Reproducible from a clean checkout.
#
#   Requirements: circom (>=2.1), snarkjs, a powers-of-tau file.
#   Usage: ./js/build-circuit.sh   (run from the privacy/ directory)
#
# NOTE: the Phase-2 contribution below uses a fixed entropy string so the build
# is deterministic for development. For ANY real deployment you MUST run a fresh,
# multi-party Phase-2 ceremony — a single-party setup is NOT trustless.
set -euo pipefail

cd "$(dirname "$0")/.."   # -> privacy/
CIRCOMLIB="js/node_modules/circomlib/circuits"
PTAU_POWER=14
PTAU="build/pot${PTAU_POWER}_final.ptau"
SNARKJS="node js/node_modules/snarkjs/cli.js"

mkdir -p build

echo "==> compiling circuit"
circom circuits/withdraw.circom --r1cs --wasm --sym -o build \
  -l "$CIRCOMLIB" -l circuits

if [ ! -f "$PTAU" ]; then
  echo "==> fetching powers of tau (2^${PTAU_POWER})"
  curl -sSL -o "$PTAU" \
    "https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_${PTAU_POWER}.ptau"
fi

echo "==> groth16 setup"
$SNARKJS groth16 setup build/withdraw.r1cs "$PTAU" build/withdraw_0000.zkey

echo "==> phase-2 contribution (DEV ONLY — replace with a real ceremony)"
$SNARKJS zkey contribute build/withdraw_0000.zkey build/withdraw_final.zkey \
  --name="dev-contribution-1" -e="launchpad privacy dev entropy"

echo "==> export verification key"
$SNARKJS zkey export verificationkey build/withdraw_final.zkey build/verification_key.json

echo "==> export solidity verifier"
$SNARKJS zkey export solidityverifier build/withdraw_final.zkey src/Verifier.sol
# snarkjs emits an old pragma + 'Pairing' lib name; normalise it.
sed -i 's/pragma solidity ^0.6.11;/pragma solidity ^0.8.0;/' src/Verifier.sol
sed -i 's/contract Groth16Verifier/contract Verifier/' src/Verifier.sol

echo "==> done. verifier at src/Verifier.sol"
