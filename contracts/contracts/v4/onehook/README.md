# OneHook v2: factory-held liquidity, swap-only hook

Ethereum mainnet launchpad on Uniswap v4. One immutable hook runs every
coin's instincts (fee engine, anti-snipe, reflexive buyback, dividends,
max-wallet, evolution) under a constitution nothing can break.

## What changed from the first mainnet deployment

The first deployment (hook `0x6B5115B6…eaEC`, factory `0xBfC05d1a…6Edf`) kept
each coin's launch position **inside the hook**: the hook had the
`beforeInitialize`, `beforeAddLiquidity`, `beforeRemoveLiquidity` and
`beforeDonate` permissions, owned the position, and exposed `collect`, which
the factory admin called through the factory. Scanners that audit the token
and the pool hook flagged that as a critical "liquidity drain in the hook".

This version moves the liquidity out of the hook entirely:

| | v1 (hook-held) | v2 (this directory) |
|---|---|---|
| Hook permissions | 8 flags, address `…eaEC` | 4 swap flags only, address `…CC` |
| Launch position | owned by the hook | owned by the factory (`positions[token]`) |
| Seeding | `hook.registerPool` seeded | `OneFactory.launch` seeds via its own `unlockCallback` |
| `collect` | hook (called by factory) | factory only, `onlyAdmin`, emits `Collected` |
| Gene caps | factory only | factory **and** hook (`OneHook._checkGenes` in `registerPool`) |
| Fee flow, pots, buyback, dividends, evolution | unchanged | unchanged |

The hook can no longer gate pool initialization or liquidity changes, holds
no coins, and has no code path that moves liquidity. The admin's `collect`
still exists, in the factory, and is the one disclosed power over a coin's
pool liquidity. It is admin-only and every call is logged.

## Files

- `OneHook.sol` — the swap-fee engine (unchanged instincts, no liquidity).
- `OneFactory.sol` — launch, position custody, admin surface, `collect`.
- `OneRouter.sol`, `OneTokenDeployer.sol`, `OneToken.sol`, `OneDivToken.sol`,
  `IOneOracle.sol` — identical to the verified mainnet sources.
- `mocks/MockOneOracle.sol` — test oracle.

## Build, test, deploy

```bash
cd contracts
npx hardhat compile --config hardhat.config.min.ts
npx hardhat test --config hardhat.config.min.ts test/v4/onehook.local.test.ts

ONEHOOK_ADMIN=0x… ONEHOOK_ORACLE=0x… ONEHOOK_FEE_RECIPIENT=0x… \
  npx hardhat run scripts/deploy-onehook.ts --network mainnet
```

The deploy script mines a `…CC` hook address, wires the token deployer, hook
and router, writes `deployments/onehook-mainnet.json`, and prints the
`hardhat verify` commands. `ETHERSCAN_API_KEY` goes in the gitignored
`contracts/.env`.

## Frontend notes

- `positionOf(token)` moved from the hook to the factory.
- `collect(token, bps, recipient)` is called on the factory, as before.
- The hook ABI no longer has `collect` or `positionOf`; everything else
  (`genesOf`, `stagesOf`, `feeBpsNow`, `payCreator`, `pushPlatform`,
  `buybackBurn`, `pushDividends`, pots and owed views) is unchanged.
