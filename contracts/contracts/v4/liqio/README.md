# Liqio contracts (v1)

Liqio is Equo on HyperEVM: the same hook and router, a factory without the admin `collect`, coins that are
EIP-1167 clones so a launch fits HyperEVM's 3M-gas small block, and an oracle that reads HyperCore's prices
from the precompile instead of a keeper.

## Files

| File | What it is |
|---|---|
| `LiqioFactory.sol` | `EquoFactory` minus `collect`, the `Collected` event and the unlock action behind them. Nothing on any Liqio contract removes launch liquidity. |
| `LiqioToken.sol`, `LiqioDivToken.sol` | The coin, as an initialisable implementation behind minimal proxies. Same surface as the Equo coins (permit, burn, holder rewards). |
| `LiqioTokenDeployer.sol` | Clones a coin at the first salt whose address sorts below the pair token and mints the supply to the factory. Same `deploy` / `predict` interface the factory already speaks. |
| `LiqioOracle.sol` | `IOneOracle` over HyperCore's oracle price precompile (`0x…0807`): perps by index, HIP-3 markets at `10000 * dex + index`, a multiplier (SPY at a tenth of the S&P 500) and the ERC-4626 share ratio of a wrapped xStock. Stablecoins are fixed. |
| `mocks/LiqioMocks.sol` | The precompile, ERC-20s, a wrapped xStock and a V3/Algebra-callback pool for tests. |
| `../equo/EquoHook.sol`, `../equo/EquoRouter.sol` | Reused unchanged. The router's V3 path serves PRJX, its Algebra path KittenSwap. |

## Sizes and gas

| Contract | Bytes (limit 24,576) |
|---|---|
| LiqioFactory | 23,040 |
| EquoHook | 17,319 |
| EquoRouter | 8,424 |
| LiqioTokenDeployer | 2,407 |
| LiqioOracle | 2,500 |

One launch (clone + pool + position + wiring), measured locally: 0.92M gas plain, 1.17M with a dev buy,
1.23M with a routed dev buy on USDC or an xStock, 1.46M for a rewards coin. HyperEVM small blocks hold 3M.

## HyperCore markets (verified on chain 2026-10-23)

| Pair token | Market | Precompile index | szDecimals | Extra |
|---|---|---|---|---|
| WHYPE | HYPE perp | 159 | 2 | |
| USDC | fixed $1 | | | |
| wNVDAx | xyz:NVDA | 10002 | 3 | share ratio |
| wSPYx | xyz:SP500 | 10052 | 3 | × 0.1, share ratio |
| wSPCXx | xyz:SPCX | 10076 | 2 | share ratio |
| wGMEx | xyz:GME | 10041 | 2 | share ratio |
| wMUx | xyz:MU | 10015 | 3 | share ratio |
| wSKHYx | xyz:SKHY | 10099 | 2 | share ratio |

wQQQx has no HyperCore market and is not listed. The precompile returns the price with `6 - szDecimals`
decimals; the oracle scales it to USD per 1e18 base units.

## Tests

```bash
npx hardhat test test/v4/liqio.local.test.ts
HYPEREVM_FORK=1 HYPEREVM_RPC_URL=https://… npx hardhat test test/v4/liqio.fork.test.ts
```

The local suite runs on a fresh chain with the real PoolManager and the precompile mocked at its address. The
fork suite runs against HyperEVM itself: real WHYPE, USDC, wNVDAx and the PRJX pools, with the precompile
seeded from live values (a fork cannot execute native precompiles).

## Deploying

```bash
# 1. big blocks on for the deployer (contract deployments exceed the small block)
python -m venv .hlvenv && .hlvenv/bin/pip install hyperliquid-python-sdk
.hlvenv/bin/python scripts/liqio-big-blocks.py on
# 2. deploy, wire, set price sources, presets and reward split, renounce setup rights
LIQIO_CONFIRM_DEPLOY=1 ONEHOOK_ADMIN=0x… EQUO_CAP_PRESETS=3000,10000,25000 EQUO_CASHBACK_BPS=2500 EQUO_REFERRAL_BPS=2500 RENOUNCE=1 \
  npx hardhat run scripts/deploy-liqio.ts --network hyperevm
# 3. big blocks off, then the verify commands the script prints
.hlvenv/bin/python scripts/liqio-big-blocks.py off
```

`DRY_RUN=1 npx hardhat run scripts/deploy-liqio.ts` rehearses the same steps locally. The deployer key lives
in the gitignored `contracts/.env.deployer`; the Etherscan key (HyperEVMScan uses the Etherscan v2 API) in
`contracts/.env`.

After the deploy: fill `contracts` and `deployBlock` in `liqio-site/config.js`, set `preview: false`, and
point the indexer at HyperEVM.
