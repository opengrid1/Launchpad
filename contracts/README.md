# Loxley contracts

On-chain backing for the Loxley launchpad (Robinhood Chain, chainId 4663).
Built on **Uniswap v4** — the pool's hook makes the 1% trade tax impossible to
dodge, which a v3 pool can't guarantee.

## Fixed terms (enforced in code, no setters, no admin)

- **1B** total supply, whole supply seeded single-sided into the pool
- **1%** trade tax (max, never raised), taken in **ETH** by the hook on every swap
- Tax split **50% to holders** (pro-rata) / **50% to the creator** — nothing else
- **$2.5K virtual** starting market cap — launch price is derived, not set
- No presale, no bonding curve, no graduation, no refunds; live from block one
- **No owner, no LP withdrawal, no protocol cut** — the LP position has no owner
  that can pull it, and there is no function anywhere that moves a holder's
  principal. The "no rug" guarantee is structural, not a promise.

## Contracts

| Contract | Role |
| --- | --- |
| `LoxleyFactory` | one-tx launch: deploy token, open v4 pool, seed liquidity, optional dev buy |
| `LoxleyToken` | fixed-supply ERC-20; pings the distributor on transfer (no transfer tax) |
| `LoxleyHook` | v4 `afterSwap` hook; skims 1% ETH → distributor (rate is a constant) |
| `RewardsDistributor` | holds ETH tax; 50/50 split; holder accumulator + creator claims |

## Deployment target

- **Chain:** Robinhood Chain (chainId **4663**)
- **AMM:** Uniswap **v4** (v2/v3/v4/UniswapX are all live there). v4 is required
  because the hook makes the 1% impossible to bypass — a v3 pool can't guarantee
  that. Deployment needs the chain's v4 `PoolManager` address.

## Status

Scaffolded here as reference logic. The v4 import paths/signatures target a
pinned `v4-core` / `v4-periphery` — install them and adjust versions before
compiling:

```bash
forge install uniswap/v4-core uniswap/v4-periphery
forge build
```

The hook must be deployed at a **mined CREATE2 address** whose low bits set the
`AFTER_SWAP` + `AFTER_SWAP_RETURNS_DELTA` flags (standard v4 requirement).
