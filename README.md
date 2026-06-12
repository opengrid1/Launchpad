# HyperEVM Launchpad — flaunch-style, direct trading on HyperSwap V3

A token launchpad for [HyperEVM](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm) modeled on [flaunch.gg](https://flaunch.gg): **no bonding curve, no sale phase**. Tokens are born directly inside a HyperSwap V3 pool and trade on the DEX from block one. Revenue comes from the pool's 1% swap fee tier, split **70% to the token creator / 30% to the platform**.

## How a launch works

1. **Create.** A creator calls `createToken(name, symbol, tokenURI, totalSupply, priceWeiPerToken, minDevBuyTokens)`. In one atomic transaction the launchpad:
   - deploys a fixed-supply ERC20 (`LaunchToken`) carrying an immutable **`tokenURI`** (e.g. `ipfs://...` JSON with image/description/socials for frontends);
   - creates and initializes the TOKEN/WHYPE pool on HyperSwap V3 at the creator's chosen starting price (1% fee tier);
   - deposits **100% of the supply as single-sided liquidity** (tokens only — the range sits entirely on the token side of the starting price, so buyers swap HYPE into it);
   - optionally executes the **dev buy**: any HYPE sent as `msg.value` is swapped for tokens to the creator, making them provably the first buyer at the listed price. Front-running is impossible because the token doesn't exist until this call.
2. **Trade.** Everyone buys/sells directly on HyperSwap V3. HYPE paid by buyers accumulates inside the LP position as principal.
3. **Collect.** Anyone can poke `collectFees(token)`. Accrued swap fees are pulled from the position; token-denominated fees are swapped to WHYPE with a **TWAP-bounded minimum** (5-minute window, 5% max deviation) so the keeper call can't be sandwiched — if the bound fails or the pool is too young, those fees are credited in-kind instead.
4. **Claim.** The creator claims their 70% with `claimCreatorFees` (paid in native HYPE plus any in-kind tokens). The treasury claims the platform's 30% with `claimPlatformFees` / `claimPlatformTokenFees`. The creator fee stream is transferable via `transferCreator`.

## Contracts

| File | Purpose |
| --- | --- |
| `src/Launchpad.sol` | Factory + LP owner + fee splitter: create, collect, claim, admin |
| `src/LaunchToken.sol` | Minimal fixed-supply ERC20 with `tokenURI` (no owner, no mint, no hooks) |
| `src/interfaces/IHyperswapV3.sol` | Minimal HyperSwap V3 (UniswapV3-style) interfaces |
| `src/libraries/` | Uniswap `TickMath` / `FullMath` (vendored, 0.8 branch) |
| `script/Deploy.s.sol` | Foundry deploy script, mainnet addresses preconfigured |
| `test/Launchpad.t.sol` | Test suite (18 tests, mocked HyperSwap V3) |

## HyperSwap V3 mainnet addresses (verified on-chain)

| Contract | Address |
| --- | --- |
| NonfungiblePositionManager | `0x6eDA206207c09e5428F281761DdC0D300851fBC8` |
| SwapRouter (V1-style, with deadline) | `0x4E2960a8cd19B467b82d26D83fAcb0fAE26b094D` |
| V3 Factory | `0xB1c0fa0B789320044A6F623cFe5eBda9562602E3` |
| WHYPE | `0x5555555555555555555555555555555555555555` |

1% fee tier tick spacing: `200`.

## Build & test

```bash
forge test -vv
```

(`lib/forge-std` is required: `git clone --depth 1 https://github.com/foundry-rs/forge-std lib/forge-std`)

## Deploy to HyperEVM mainnet

```bash
export PRIVATE_KEY=0x...
export TREASURY=0x...   # platform fee recipient, defaults to deployer
forge script script/Deploy.s.sol --rpc-url hyperevm --broadcast
```

RPC endpoints are preconfigured in `foundry.toml` (mainnet chain id `999`, testnet `998`; for testnet override `POSITION_MANAGER`, `SWAP_ROUTER`, `WHYPE` via env).

> **HyperEVM big blocks:** contract deployments often exceed the small-block gas limit (2M). Flip your deployer address to big blocks (30M gas, ~1 min blocks) before deploying — via the `evmUserModify` L1 action or a community toggle UI — then flip back.

## Security properties & known trade-offs

- **Atomic launch:** token deploy, pool creation, price init and liquidity mint happen in one tx — the pool cannot be front-run or pre-initialized at a hostile price.
- **Fee split is immutable:** 70/30 is a constant; the owner has no power over it.
- **Sandwich-resistant fee conversion:** the token→WHYPE fee swap is bounded by the pool's 5-min TWAP; on failure it degrades to in-kind crediting, never a bad fill.
- **Pull payments everywhere:** creators and treasury withdraw; `collectFees` never pushes funds to arbitrary receivers.
- ⚠️ **`withdrawPosition` (owner-only) can pull any launch's LP NFT at any time.** This was added as an explicit admin escape hatch / migration tool — but it means **liquidity is NOT trustlessly locked** and the platform owner can rug any pool. Outstanding fees are settled 70/30 before the position leaves, and `collectFees` is disabled for that token afterwards. Put the owner key behind a multisig and/or timelock, and disclose this to your users. Delete the function if you want flaunch-grade "liquidity locked forever" guarantees.
- This is a reference implementation and has **not been audited**. Test on HyperEVM testnet (chain id 998) before putting real funds behind it.
