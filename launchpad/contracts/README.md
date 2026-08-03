# Coinworks contracts

Solidity for the Coinworks B20 launchpad on Base.

## Setup

```bash
./setup.sh        # fetch forge-std + base-std into lib/
forge test        # 15 tests
```

## Contracts

| Contract | Purpose | Status |
|---|---|---|
| `WorkPresale.sol` | Records contributions on-chain and forwards ETH straight to the project wallet. No per-wallet limit; hard cap enforced. | Done, tested |
| `WorkDistributor.sol` | Pays out `$WORK` to contributors pro-rata at the fixed presale price once the sale is closed. Batched, idempotent. | Done, tested |
| `script/DeployPresale.s.sol` | Deploys `WorkPresale`. Can run now (no B20 dependency). | Ready |
| `script/CreateWork.s.sol` | Creates the native `$WORK` B20 via the factory precompile, mints supply, deploys + funds the distributor. Run after B20 is live. | Ready (validate on Sepolia first) |

`$WORK` is a **native B20 token** (address starts `0xB200…`). It is created through
the B20 factory precompile at `0xB20f0000000000000000000000000000000000000`, not by
deploying bytecode. Encoders come from Base's official `base-std` library.

## Deploy order

B20 is live on **Base Sepolia now** and **Base mainnet from 2026-06-25 18:00 UTC**.
Validate the full flow on Sepolia before mainnet.

```bash
export PRIVATE_KEY=0x...          # deployer / admin / treasury
export RPC=https://sepolia.base.org   # or a Base mainnet RPC

# 1. Presale (can deploy any time)
forge script script/DeployPresale.s.sol --rpc-url $RPC --private-key $PRIVATE_KEY --broadcast
#    -> note the WorkPresale address

# 2. After B20 is live: create $WORK + distributor, fund it
export ADMIN=0x...                # = deployer
export PRESALE=0x...              # from step 1
export SALT="coinworks-work-v1"   # fixes the deterministic 0xB200... address
forge script script/CreateWork.s.sol --rpc-url $RPC --private-key $PRIVATE_KEY --broadcast
#    -> note the WORK token + WorkDistributor addresses

# 3. After the presale ends
#    presale.close()              (owner)
#    distributor.distribute(N)    (owner; repeat in batches until finished)
```

## Token economics

- Total supply: 1,000,000,000 WORK
- Presale price: 0.00000004 ETH per WORK (`priceWeiPerToken = 40_000_000_000`)
- Presale allocation: 250,000,000 WORK (25%), funded into the distributor
- Soft cap 5 ETH, hard cap 10 ETH, no per-wallet limit

## Still to build

- **V4 single-sided liquidity launcher** (Uniswap v4 on Base). Trading model:
  single-sided pool, the LP position held in the contract, owner-withdrawable.
  Needs the Uniswap v4 periphery and fork tests against Base. The site copy that
  says "liquidity is locked" must be updated to "liquidity managed by the project"
  to stay accurate.
