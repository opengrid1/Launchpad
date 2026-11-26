# Launchpad v4 (HyperEVM)

The Pons v2 launchpad (MIT, see `NOTICE.md`), byte-for-byte the contracts that run on Robinhood Chain, built
for HyperEVM (chain id 999, gas and quote asset HYPE). The mechanism is written up in
`../research_notes/pons-v2-mechanism.md`; `../research_notes/hyperevm-launchpad.md` covers HyperEVM itself
(block limits, gas, what the chain has and lacks) and the launchpad the user pointed at (alt.fun).

What a launch is: a constant-product curve with a 48 HYPE virtual reserve that sells 5/7 of a 1B supply until
120 HYPE is raised, then graduates into a Uniswap v4 pool (fee 0, tick spacing 200, our hook) seeded with the
120 HYPE and 10/49 of the supply at the curve's final price, the position locked forever; 4/49 of the supply
is locked too. 1% fee on the quote side before and after, 70% creator / 30% protocol, frozen per launch;
optional creator tax up to 10%; a 99% snipe tax on buys that halves fourteen times across the first 3
seconds (HyperEVM small blocks are 1 s apart); launch and opening buy in one transaction.

## Layout

- `contracts/src/v2` the contracts; `contracts/lib` their exact dependencies; `build/locker-unit` the two files
  of the locker's older verified build (same code, older name).
- `build/compile.cjs` compiles with each contract's verified settings (`build/verified-settings.json`) into
  `artifacts/`; `--check` proves the output matches Robinhood Chain's bytecode.
- `build/pool-manager.sourcify.json` and `build/position-manager.sourcify.json`: the official Uniswap v4
  PoolManager and PositionManager builds (Sourcify, Base), deployed by `deploy.cjs` because HyperEVM has
  no Uniswap v4.
- `deploy.cjs` deploys and wires everything; `deployments/<network>.json` records it.
- `keeper/keeper.cjs` graduation phase 2 and fee sweeps (the sweep operator).
- `test/fork.test.cjs` the whole lifecycle against a Hardhat fork of HyperEVM.

## Build and test

```
cd launchpad-v4 && npm install
npm run build            # artifacts/
npm run check            # same, and compare with Robinhood Chain
npm run router           # the test swap router
(cd ../contracts && npx hardhat node --fork https://rpc.hyperliquid.xyz/evm --port 8547) &
npm run test:fork
```

## HyperEVM specifics

- Two block streams: small blocks every second with a 3M gas limit, big blocks every minute with 30M. An
  address chooses with the HyperCore action `evmUserModify` (`usingBigBlocks`); the helper is
  `../contracts/scripts/liqio-big-blocks.py on|off|status` (reads the deployer key, never prints it).
  Every contract of this stack and the PoolManager need big blocks to deploy.
- The Pons launch transaction is about 3.6M gas (the curve's 10.2 KB and the token's 3.2 KB are deployed
  fresh each launch), above the small-block limit, so creators could not send it as is. The launch has to
  drop under 3M (clone the token and the curve from implementations, like every HyperEVM launchpad does)
  before this goes live; that change is listed in the research note and is not made yet.
- Base fee moves (20 to 150 gwei seen on 2026-10-29, HYPE about $96): the scripts take fees from the node.
- The public RPC allows 1,000-block `eth_getLogs` pages and rate-limits; the keeper pages at 1,000 with a
  pause. Use a private RPC (`RPC=`) for anything busy.
- Uniswap v4 is officially deployed on HyperEVM: PoolManager `0x12D4Fd9C5DeDd00ab8a0bCe2CF0167bbf94b6B1F`,
  PositionManager `0x0d7Ab5B3db668128Aff6F70C4eBC71D7d4DA9bf9`, Permit2 `0x0000…78BA3`, Universal Router
  `0x9aFe3C497e19501DB228F28CdBdD29bC98F65DBa`, StateView `0x1656326235cb9E34Cb58CaDe53AE30789AB32A1A`,
  Quoter `0x108Bfe38532C98f8Cd8D7Ab49c9dDAa3675a1c5e`. The CREATE2 proxy and WHYPE (`0x5555…5555`) exist too.
  The scripts keep the ability to deploy the official PoolManager and PositionManager builds for a chain
  that has none (`poolManager: null` / no `positionManager` in `NET`).

## Deploy

```
python3 ../contracts/scripts/liqio-big-blocks.py on
KEYFILE=../contracts/.env.deployer.v3 node deploy.cjs            # dry run with gas
KEYFILE=../contracts/.env.deployer.v3 node deploy.cjs --send
python3 ../contracts/scripts/liqio-big-blocks.py off
```

The stack is about 19M gas (about 1.5 HYPE at 80 gwei, 0.2 HYPE at 10 gwei; the dry run prints the current
number). The owner in `deploy.cjs` (`NET.hyperevm.owner`) becomes the protocol fee recipient, hook owner,
factory owner and first sweep operator; when it is not the deployer, the ten wiring calls printed by the
script must be sent by the owner.

Owner powers after deployment (as in Pons): fee policy for future launches (protocol share up to 50%, hook fee
up to 10%), sweep operator, launch fee, launch switch and whitelist, snipe tax terms, pair-asset approvals,
creator-fee-recipient override with a 3-day timelock, and the delayed rescue paths. Nothing can touch a live
launch's fee terms, supply, or locked liquidity.

## Keeper

```
KEYFILE=../contracts/.env.launch-service START_BLOCK=<deploy block> node keeper/keeper.cjs
```

Needs a little HYPE for gas. It sends `createGraduatedPool` for every launch the crossing buy swept, and runs
fee sweeps once a launch's pending fees pass `SWEEP_MIN_NATIVE` (default 0.5 HYPE). The keeper's key must be
the hook's `feeSweepOperator` for sweeps that convert memecoin fees or run buybacks.
