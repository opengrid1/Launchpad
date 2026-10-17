#!/usr/bin/env bash
# Builds the private vault's spend circuit and its Groth16 keys.
#
# Phase 1 is the PSE perpetual powers of tau (80 public contributions, 2^15):
#   https://pse-trusted-setup-ppot.s3.eu-central-1.amazonaws.com/pot28_0080/ppot_0080_15.ptau
# Phase 2 below takes one local contribution and a beacon, which is fine for
# tests. Before mainnet, run a public phase-2 ceremony (several independent
# contributors, then a public beacon): proofs stay sound as long as one
# contributor destroyed their randomness.
#
#   CIRCOM=/path/to/circom PTAU=/path/to/ppot_0080_15.ptau ./circuits/setup.sh
set -euo pipefail
cd "$(dirname "$0")"
CIRCOM=${CIRCOM:-circom}
PTAU=${PTAU:?set PTAU to the powers of tau file}
SNARK="node ../../node_modules/snarkjs/build/cli.cjs"
mkdir -p build
"$CIRCOM" spend.circom --r1cs --wasm --sym --O2 -l ../../node_modules -o build
cd build
$SNARK groth16 setup spend.r1cs "$PTAU" spend_0000.zkey
$SNARK zkey contribute spend_0000.zkey spend_0001.zkey --name="local" -e="$(head -c 64 /dev/urandom | base64)"
$SNARK zkey beacon spend_0001.zkey spend.zkey "${BEACON:-0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f}" 10 -n="beacon"
$SNARK zkey export verificationkey spend.zkey spend-vk.json
$SNARK zkey export solidityverifier spend.zkey ../../contracts/v4/estonks/private/SpendVerifier.sol
sed -i 's/contract Groth16Verifier/contract SpendVerifier/' ../../contracts/v4/estonks/private/SpendVerifier.sol
rm -f spend_0000.zkey spend_0001.zkey
echo "spend.zkey, spend_js/spend.wasm and SpendVerifier.sol are ready"
