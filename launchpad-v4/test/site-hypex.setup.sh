#!/usr/bin/env bash
# Hypex E2E setup: local forks of Elysium (port 8601) and HyperEVM (8602), the Hypex stack deployed on each by the same
# deployer (the real deploy script, so the factory and bridge share their address), $HYPEX launched on each, and the
# deployment files the E2E reads (deployments/elysium-local.json, hyperevm-local.json). Test keys only: anvil's.
set -e
export PATH=$HOME/.foundry/bin:$PATH
cd "$(dirname "$0")/../hypex-eth"
pkill -f "anvil --port 860[12]" || true; sleep 1
anvil --port 8601 --fork-url https://rpc.elysium.kinetiq.xyz --chain-id 99901 --gas-limit 1000000000 --silent > /tmp/hx-anvil-ely.log 2>&1 &
anvil --port 8602 --fork-url https://rpc.hyperliquid.xyz/evm --chain-id 999 --gas-limit 30000000 --silent > /tmp/hx-anvil-hyp.log 2>&1 &
for p in 8601 8602; do for i in $(seq 1 90); do cast block-number --rpc-url http://127.0.0.1:$p >/dev/null 2>&1 && break; sleep 1; done; done
# anvil's account 9 deploys (fresh nonce on both forks), account 8 is the keeper (and leg launcher), 7 the start signer, 3 the test user
DEP_KEY=0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6
KEEPER=0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f
SIGNER=0x14dC79964da2C08b23698B3D3cc7Ca32193d9955
DEP=$(cast wallet address --private-key $DEP_KEY)
for p in 8601 8602; do
  for a in $DEP $KEEPER 0x90F79bf6EB2c4f870365E785982E1f101E93b906; do cast rpc --rpc-url http://127.0.0.1:$p anvil_setBalance $a 0x56BC75E2D63100000 >/dev/null; done
  cast rpc --rpc-url http://127.0.0.1:$p anvil_setNonce $DEP 0x0 >/dev/null
done
# Elysium is an Arbitrum Orbit chain: the hook reads ArbSys, which anvil doesn't have; a stand-in returns block.number
ARBSYS=$(python3 -c "import json;print(json.load(open('out/Blocks.t.sol/MockArbSys.json'))['deployedBytecode']['object'])")
cast rpc --rpc-url http://127.0.0.1:8601 anvil_setCode 0x0000000000000000000000000000000000000064 $ARBSYS >/dev/null
for c in "elysium 8601" "hyperevm 8602"; do set -- $c
  FB=$(cast block-number --rpc-url http://127.0.0.1:$2)
  ETH_USD=70 TEAM=0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b OWNER=0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b START_SIGNER=$SIGNER KEEPER=$KEEPER DEPLOYMENT=$1-local \
    forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:$2 --broadcast --private-key $DEP_KEY --slow -q >/dev/null 2>&1 || { echo "deploy on $1 failed"; exit 1; }
  ETH_USD=70 HYPEX_URI=ipfs://hypex DEPLOYMENT=$1-local forge script script/LaunchHypex.s.sol --rpc-url http://127.0.0.1:$2 --broadcast --private-key $DEP_KEY -q >/dev/null 2>&1 || { echo "HYPEX launch on $1 failed"; exit 1; }
  python3 -c "import json;p='deployments/$1-local.json';d=json.load(open(p));d['fromBlock']=$FB;json.dump(d,open(p,'w'),indent=1)"
  echo "$1: factory $(python3 -c "import json;print(json.load(open('deployments/$1-local.json'))['factory'])") bridge $(python3 -c "import json;print(json.load(open('deployments/$1-local.json')).get('bridge'))")"
done

# $HYPEX was launched on each chain on its own (its own address on each): the launch service pairs the two, as it
# does for every coin, so the bridge can move it
KEEPER_KEY=0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97
HE=$(python3 -c "import json;print(json.load(open('deployments/elysium-local.json'))['hypex'])"); HH=$(python3 -c "import json;print(json.load(open('deployments/hyperevm-local.json'))['hypex'])")
F=$(python3 -c "import json;print(json.load(open('deployments/elysium-local.json'))['factory'])")
cast send --rpc-url http://127.0.0.1:8601 --private-key $KEEPER_KEY $F "setRemote(address,uint16,address)" $HE 47 $HH >/dev/null
cast send --rpc-url http://127.0.0.1:8602 --private-key $KEEPER_KEY $F "setRemote(address,uint16,address)" $HH 74 $HE >/dev/null
echo "HYPEX: elysium $HE hyperevm $HH (paired)"
