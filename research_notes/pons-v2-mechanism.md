# Pons v2 mechanism, read from the verified contracts

Read on 2026-10-29 from the Sourcify-verified sources of the Pons v2 contracts on Robinhood Chain (chain id 4663):
`PonsV2LaunchFactory` (exact match), `PonsV2MemeHook`, `PonsV2BondingCurve`, `PonsV2LaunchAndBuy`,
`PonsV2GraduationExecutor`, `PonsV2GraduationGuard`, `PonsV2LaunchLocker`, `PonsV2BuybackVault`,
`PonsV2FeeEscrow`, `PonsV2LaunchDeployer`, `PonsV2LauncherToken` and the two math libraries. The live
parameters below were read from the factory and from a live curve on chain, and the graduation numbers were
checked against two real `PoolGraduated` events. Solidity 0.8.35, Uniswap v4 core and periphery, OpenZeppelin.

Addresses: factory `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e`, hook `0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044`,
launch-and-buy router `0xe33E9E479dF8802cb0866d5d05258bEc4cF62948`, locker `0x267444D099b10fB5Ed7c3Cc7B7c767AdcA574952`,
fee escrow `0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e`, buyback vault `0x42df2a798f82289E177311362e8f5ccC45c1219c`,
PoolManager `0x8366a39cc670b4001a1121b8f6a443a643e40951`.

## 1. The shape of a launch

| | |
|---|---|
| Supply | 1,000,000,000, 18 decimals, all minted to the coin's own bonding curve contract at creation |
| Curve | constant product `x * y = k` with a **virtual quote reserve** (`phantomQuote`) of **1.68 ETH** and the whole supply as the token reserve |
| Graduation | when **4.2 ETH** of real quote has been raised, which is the same moment the curve's token balance falls to its reserved allocation |
| Reserved for the pool | `supply * phantom / (phantom + threshold)` = 1B * 1.68 / 5.88 = **285,714,285 (2/7)**; the curve never sells below this |
| Sold on the curve | **714,285,714 (5/7)** |
| Opening price | 1.68 / 1e9 = 1.68e-9 ETH per token, market cap **1.68 ETH** (about $3,950 at $2,350 ETH) |
| Graduation price | (1.68 + 4.2) / 285.7M = 2.058e-8 ETH, market cap **20.58 ETH** (about $48,400): **12.25x** from open |

Trade pricing (`PonsV2BondingCurveMath`, integer constant product, fees handled outside the formula):

```
amountOut = amountIn * reserveOut / (reserveIn + amountIn)
quoteReserve = phantomQuote + trackedQuote - quoteFeeBalance - creatorTaxBalance
tokenReserve = trackedTokens
```

Both reserves are **tracked internally**, never read from live balances, so a donation (a forced ERC-20 or
ETH transfer) cannot move the price or push a launch over its threshold.

A buy takes every fee off the input first, then prices the rest. A sell is priced first and the fees come off
the output. A buy that would cross the reserved allocation is clamped to it, repriced from the token side,
and the unused input is refunded (the crossing buy is never rejected, so nobody can grief it by front-running
a small buy). Sells close the moment the curve is ready to graduate, so the pool opens at the exact reserves
the terms fixed.

## 2. Fees

| Fee | Value | Charged on | Goes to |
|---|---|---|---|
| Curve trade fee (`curveFeeBps`) | **100 bps (1%)**, per launch config, max 10% | the quote leg of every buy and sell | split below |
| Creator tax (`creatorTaxBps`) | **0 to 10%**, chosen by the creator at launch, frozen (live cap 1000 bps) | the quote leg, on top of the trade fee | the creator, in full, no split |
| Hook fee after graduation (`hookFeeBps`) | **100 bps (1%)** | the swap's *unspecified* currency in `afterSwap` | split below |
| Pool LP fee | **0** (`CoreLpFeeMustBeZero`); the hook is the only fee | | |
| Launch fee | **0.0005 ETH** | paid with the launch call | protocol fee recipient |
| Combined cap | trade fee + creator tax at most **20%** | | |

Split of the trade fee (same before and after graduation, frozen per launch at creation):

```
protocolAmount = fee * protocolFeeShareBps / 10000        -> 30% to the protocol (live 3000; max 50%)
creatorBucket  = fee - protocolAmount                      -> 70%
buyback        = creatorBucket * buybackBurnBps / 10000    -> 50% of the creator's 70% (= 35% of the fee), only if the creator enabled buyback
creator        = creatorBucket - buyback + creatorTax
```

So a plain launch pays **70% creator / 30% protocol**. With buyback on, 35% of every fee buys the coin back
against its own curve or pool and locks it in the buyback vault, which vests linearly over **5 years** and pays
out 70/30 creator/protocol as it vests. The buyback is capped at a **3% reserve move** (`maxInternalPriceImpactBps`
300) and only the trusted sweep operator can run a sweep that executes a buyback or a memecoin conversion
(it must pass a minimum output, which is the real sandwich defence).

Fees are **always denominated in the quote asset** on the curve. After graduation the hook takes its cut in
whichever currency is the unspecified side of the swap, so a fee can land in the memecoin; those are held and
converted to the quote asset in a batched sweep later. Everything is paid through `PonsV2FeeEscrow`, one
claimable balance per recipient across all their launches (`claim()` / `claimToken()`).

## 3. Snipe tax (anti-bot)

Buys only. Starts at **99%** in the launch second and halves fourteen times across the window:

```
snipeTaxBps(elapsed) = snipeTaxStartBps >> (elapsed * 14 / snipeTaxSeconds)     // 0 once elapsed >= window
```

Live settings: start 9,900 bps, window **3 seconds** (the docs say 5; the chain says 3): second 0 = 99%,
second 1 = 6.18%, second 2 = 0.19%, second 3 onward = 0. Capped so a taxed buy still nets the buyer at least
1% of their spend. Exempt: the launching wallet, the creator fee recipient, and up to 32 wallets the creator
lists at launch (so a team's bundled opening buys clear untaxed). The tax joins the ordinary fee bucket and
is split 70/30 like any other fee. Terms are snapshotted into each curve at launch, so a factory retune never
changes a live launch.

## 4. Launch flow

1. `PonsV2LaunchAndBuy.launchAndBuy(params, configId, pairToken, quoteIn, minTokensOut, recipient, exemptions)`:
   launch and the creator's first buy in **one transaction**, so there is no public state between the two for a
   bot to trade against. A failed buy reverts the launch. Launch fee + buy are sent as `msg.value`.
2. The factory deploys the curve and the token with **CREATE2**, salt namespaced by the creator's address, so
   addresses are predictable and vanity addresses are mineable; the whole supply mints to the curve.
3. The creator may pin `expectedEconomics` (a digest of every owner-settable term) so an owner re-peg cannot
   land under an in-flight launch.
4. Launching is gated by `canLaunch(address)` (a whitelist plus a global switch).

## 5. Graduation, two permissionless phases

**Phase 1, `graduate(token)`** (also tried automatically inside the crossing buy, in a try/catch so the buy
never fails because of it): preflight that the seed is mintable, sweep pending fees, mark the curve
graduated, move the real quote (4.2 ETH) and the reserved tokens (285.7M) into the factory.

**Phase 2, `createGraduatedPool(token)`**: derive the pool seed that keeps the curve's final price once the
virtual reserve is gone:

```
poolTokens = reservedTokens * sweptQuote / (sweptQuote + phantomQuote)
           = 285,714,285 * 4.2 / 5.88 = 204,081,632   (10/49 of supply)
leftover   = 81,632,653                                (4/49 of supply) -> locked forever in the locker
sqrtPriceX96 = sqrt(amount1 / amount0) * 2^96
```

Then `poolManager.initialize(key, sqrtPrice)` with `fee = 0`, `tickSpacing = 200`, `hooks = memeHook`, register
the pool with the hook, and mint **one full-range position** through the v4 PositionManager **directly to the
locker**, which has no withdraw and no arbitrary-call function. Rounding dust goes to the treasury (or to the
locker if it is the launch token). Verified on chain: 204,081,632.65 tokens + 4.2000 ETH in the pool,
81,632,653.06 locked, for a native launch at block 100,468,123.

Price continuity: curve end price 5.88 / 285.7M = pool price 4.2 / 204.08M = 2.058e-8. No oracle and no swap
anywhere in graduation, because the curve already collected the pool's own quote asset from the first trade.

Pool liquidity at graduation: 4.2 ETH + 204M tokens, about 8.4 ETH of value both sides, 4.2 ETH of it real.

If a seed can only fail (a config the preflight refuses), the owner can force-sweep and, after a **7-day**
delay, return the reserves (`rescueSweptGraduation`).

## 6. The hook (`PonsV2MemeHook`), one singleton for every graduated pool

Permissions: `beforeInitialize` (only the factory may initialize a pool with this hook) and `afterSwap` with
`afterSwapReturnDelta`. Nothing else. `afterSwap` takes `hookFeeBps + creatorTaxBps` of the unspecified
currency out of the PoolManager with one `take`, credits two pending balances per pool and currency, earmarks
the buyback slice at that moment, and returns the taken amount as the hook delta. Internal conversion and
buyback swaps run inside the hook's own `unlock` with a `sqrtPrice` limit derived from the 3% impact cap;
v4 skips the hook when the hook itself swaps, so those are never taxed.

Owner powers on the hook: change the fee policy for **future** launches (protocol share max 50%, hook fee max
10%), set the protocol recipient and the sweep operator, `rescuePoolFees` (pays the regular split directly
when the escrow path is broken). Ownership cannot be renounced (an ownerless hook could never rotate the
sweep operator). Fee terms of a live pool are frozen at registration.

## 7. Other pieces

- **Locker**: holds the position NFT and the leftover supply forever. No `collectFees`, no withdraw.
- **Fee escrow**: pull-payment ledger, native and ERC-20, partial claims allowed.
- **Buyback vault**: one weighted-average 5-year vest per coin; `release()` only by a beneficiary.
- **Creator fee recipient**: the creator can hand it off at any time; the protocol owner can override with a
  3-day timelock and a 3-day execution window (recovery of a compromised key).
- **Custom quote assets**: owner-approved ERC-20s with their own `phantomQuote` and threshold in their own
  decimals (min 6 decimals). The curve shape only depends on `threshold / (threshold + phantom)`, so a stock-
  paired launch trades identically to a native one of the same size. Not relevant on Elysium (HYPE only).
- **Audits named in the docs**: SB Security, Dingbats, Pashov Audit Group.

## 8. What it means in numbers

For a native launch, from open to graduation:

| | ETH | USD at $2,350 |
|---|---|---|
| Opening market cap | 1.68 | 3,950 |
| Raised from buyers on the curve | 4.2 (+ 1% fees, + snipe tax) | 9,870 |
| Market cap at graduation | 20.58 | 48,400 |
| Pool at graduation (both sides) | 8.4 | 19,740 |
| Real quote in the pool | 4.2 | 9,870 |
| Fees to creator on the curve (1% of 4.2 ETH * 70%) | 0.0294 | 69 |
| Fees to protocol on the curve | 0.0126 | 30 |

The same shape in HYPE (at $81): `phantomQuote` 48 HYPE, threshold 120 HYPE (the same 2:5 ratio, so the same
2/7 reserved, 10/49 to the pool, 4/49 locked): opening cap about $3,900, $9,700 raised to graduate,
graduation cap about $47,800, 120 HYPE of real liquidity in the pool.
