# Self-Audit Report — HyperEVM Launchpad (flaunch-style)

Scope: `src/Launchpad.sol`, `src/LaunchToken.sol`, `src/interfaces/IHyperswapV3.sol`,
vendored `src/libraries/{TickMath,FullMath}.sol`, `script/Deploy.s.sol`.
Method: manual line-by-line review + 20-test Foundry suite against mocked HyperSwap V3
(both token orderings). This is a self-review, **not a substitute for an independent
third-party audit** before significant TVL.

## Summary

No critical or high-severity issues found in the implemented logic. The two largest
risks are **by design** and must be handled operationally: the owner's LP withdrawal
power (H-1) and the unaudited-fork caveat. Everything else below is documented
behavior or low severity.

---

## Findings

### H-1 (design risk, acknowledged): `withdrawPosition` is a rug switch
The owner can transfer any launch's LP NFT out at any time. Whoever holds the NFT can
burn liquidity and take both sides of the pool. Mitigations in code: fees are settled
70/30 before withdrawal, the action is irreversible and loudly evented
(`PositionWithdrawn`), and `collectFees` is disabled afterwards so accounting can't
desync. **Operational requirement: put `owner` behind a multisig and/or timelock and
disclose the power publicly.** Remove the function for trustless "locked forever"
guarantees.

### M-1 (design, accepted): TWAP suppression can force in-kind fee crediting
An attacker who holds the pool's 5-minute TWAP below fair value (costly: 1% fees +
inventory risk + arb pressure) makes `swapTokenFeesToHype` revert its bound, so fees
are credited in-kind (tokens) instead of HYPE. **No funds are lost** — worst case is
deferred conversion; creators receive tokens they can sell themselves. Conversely,
sandwiching the conversion swap is capped at 5% below a 5-minute TWAP of fee-sized
amounts. Frequent `collectFees` calls keep the at-risk amount small.

### M-2 (operational): `createToken` exceeds HyperEVM small-block gas (2M)
Creating a Uniswap-V3-style pool alone costs ~4.3M gas; with token deploy, cardinality
pre-pay (32 slots), mint and optional dev buy, a launch lands at roughly 6M gas.
**Launch transactions must run in big blocks** (30M): either creators toggle their
address via the `evmUserModify` L1 action, or the platform fronts launches through a
big-block-enabled relayer (would require adding a `creator` parameter — not currently
implemented).

### L-1: treasury contract that rejects HYPE can block its own claims
`claimPlatformFees` unwraps WHYPE and pushes native HYPE to `treasury`. A treasury
that reverts on receive blocks only the platform's claims; `setTreasury` recovers.
Same applies to a creator contract for `claimCreatorFees`; `transferCreator` recovers.
Creator and platform accounting are isolated, so neither can block the other.

### L-2: `transferCreator` moves unclaimed balances with the role
Documented in natspec. Anyone buying a fee stream OTC should require the seller to
claim first or price the unclaimed balance in.

### L-3: token metadata is unvalidated
`name`, `symbol`, `tokenURI` are arbitrary strings; impersonation/spam launches are
possible (true of every permissionless launchpad). Filter at the frontend/indexer
level; the canonical registry is the `TokenLaunched` event from your deployment only.

### I-1 (informational) — verified-safe items
- **Reentrancy:** all value-moving functions are `nonReentrant`; balances are zeroed
  before transfers (CEI); cross-function reentrancy from claim callbacks is blocked by
  the shared lock. `swapTokenFeesToHype` is self-call-only.
- **Atomic launch:** token, pool, price and liquidity are created in one tx — the pool
  cannot be front-run or pre-initialized at a hostile price; the dev buy cannot be
  sandwiched (nothing can interleave within a transaction).
- **Token orderings:** both `token < WHYPE` and `token > WHYPE` paths are implemented
  and tested (tick range mirrored, price ratio inverted).
- **Math bounds:** `_sqrtPriceX96` rejects prices outside `[MIN_SQRT_RATIO,
  MAX_SQRT_RATIO]`; `_singleSidedRange` rejects ranges that collapse at tick extremes;
  `FullMath.mulDiv` reverts on 256-bit overflow, and any overflow inside the TWAP
  quote is caught by `collectFees`'s try/catch (degrades to in-kind, never mis-prices).
  `_sqrt`'s initial guess `(x>>1)+1` cannot overflow and converges for all x.
- **Fee split:** 70/30 uses constant BPS math; rounding dust (≤1 wei per collect)
  favors the platform side; `uint128` collect caps simply defer the excess to the next
  collect.
- **Allowances:** WHYPE→router is max-approved once (WETH9-style allowance is not
  decremented at max); LaunchToken→router/positionManager approvals are exact-amount
  and fully consumed in the same call.
- **Native HYPE:** `receive()` only accepts from WHYPE; the contract never holds idle
  native balance.
- **Supply hygiene:** mint rounding dust is burned to `0xdEaD`; the launchpad holds no
  untracked tokens.
- **External deps:** HyperSwap V3 position manager, router (V1 `ISwapRouter` layout
  with `deadline`), factory, WHYPE and the 1% tier's tick spacing (200) were verified
  directly on HyperEVM mainnet (chain id 999) via RPC. `TickMath`/`FullMath` are
  vendored unmodified from Uniswap `v3-core` branch `0.8`.

### M-3 (dependency): HyperCore oracle precompile for USD-pegged launch cap
`createToken` derives the launch price from `startingMarketCapUsd6` (default $4,000)
using the HyperCore perp oracle precompile (`0x...0807`, HYPE index 159, raw price
carries 4 decimals for HYPE's szDecimals=2). The scaling was verified empirically on
mainnet against the independent HyperCore spot feed (both report ~$60.5 at review
time). Risks: a HyperCore interface change breaks launches (fail-closed — `createToken`
reverts, nothing mis-prices); the owner's `setManualHypeUsd` fallback lets the owner
set an arbitrary HYPE/USD for future launches (same trust class as H-1; existing pools
are unaffected). The perp *oracle* price is validator-sourced, not the AMM spot, so it
is not flash-loan manipulable.

## Residual risks
- HyperSwap V3 itself is a Uniswap V3 fork; this review did not audit HyperSwap's
  deployments for modifications.
- `LaunchToken` rebasing/weird-token issues don't apply (only self-deployed tokens and
  WHYPE are handled).
- No third-party audit has been performed.
