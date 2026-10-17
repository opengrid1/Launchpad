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

### Open source, including every user-launched coin

```bash
# 1. one coin of each variant, from the deployer (no dev buy)
npx hardhat run scripts/launch-onehook-test.ts --network mainnet
# 2. Etherscan for the five core contracts and both coins
npx hardhat run scripts/verify-onehook.ts --network mainnet --config hardhat.config.ts
# 3. Sourcify (v2 API; hardhat-verify still calls the retired v1 endpoint)
node scripts/sourcify-onehook.mjs mainnet
```

## Mainnet deployment (2026-10-17)

| Contract | Address |
|---|---|
| OneHook (swap-only, flags `0xCC`) | `0x0bcD3394Dffc047D146E76bCc461d8bEAC9fC0CC` |
| OneFactory (holds liquidity, admin `collect`) | `0xBaa02255Dc8419A4266Be406F72E11De1B901E39` |
| OneTokenDeployer | `0xEE03B300BBb2395b0de6e6AaEaE30432b81ef332` |
| OneRouter | `0xC7ED71a86754D6a3928225f613282Ac65B972678` |
| HookDeployer (CREATE2) | `0x7D22d7D98fa4a50B10c37da1cd2D76564436EC64` |
| Admin / fee recipient | `0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b` |
| Scan coin OHSA (OneToken) | `0xB3DE27D60277de084F5cCDb6D27F3886e81Cf1B2` |
| Scan coin OHSB (OneDivToken) | `0x8a195154e1127F7dd42D0d621110e97dd3ce9111` |

All verified on Etherscan and Sourcify (exact match). Deployer setup rights
renounced; see `deployments/onehook-mainnet.json`.

`OneToken` and `OneDivToken` take no constructor arguments: a coin reads its
name, symbol, metadata and supply back from `OneTokenDeployer` while it is
being constructed, so every coin of a variant has byte-identical creation
code. Once one `OneToken` and one `OneDivToken` are verified, Etherscan marks
each coin a user launches afterwards as a verified similar match, and
Sourcify matches them the same way. The two scan coins can be hidden from
the listing with `factory.setHidden`.

## Frontend notes

- `positionOf(token)` moved from the hook to the factory.
- `collect(token, bps, recipient)` is called on the factory, as before.
- The hook ABI no longer has `collect` or `positionOf`; everything else
  (`genesOf`, `stagesOf`, `feeBpsNow`, `payCreator`, `pushPlatform`,
  `buybackBurn`, `pushDividends`, pots and owed views) is unchanged.
