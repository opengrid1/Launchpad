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

## 9. The rest of the platform (off-chain and policy), from docs.ponsfamily.com and public coverage

**PONS token and the protocol's 30%.** PONS (1B fixed supply, launched through the legacy v1 factory, 90/10
split, WETH v3 pool locked) is the platform's own coin. The protocol's fee share lands in a collector wallet;
an **automated TWAP executor spends 80% of it buying PONS in small orders and sends the coins to the burn
address**; the other 20% pays infrastructure and the team. About 29% of PONS (around 290M) had been burned
by September 2026. The docs say this 80% rule is **not immutable yet** and will be made on-chain later. PONS
has no stated utility (no governance, staking or fee discount); it is a revenue-backed burn story.

**Operator and keepers (run by the team).**
- *Sweep operator*: the only address allowed to run a fee sweep that needs an internal swap (a buyback, or
  converting memecoin-denominated hook fees to the quote asset), because it must pass a minimum output. A
  creator can still sweep plain quote-denominated fees. Fees reach the escrow only after a sweep.
- *Graduation keeper*: the crossing buy tries `graduate` itself; if it fails (`AutoGraduationFailed`), the
  keeper calls `graduate` then `createGraduatedPool`. Both are permissionless, anyone can do it.
- *Unclaimed creator rewards*: "may be claimed by pons automation and sent to the creator payout wallet."
- *Migration keeper*: paces the sales of a migration (below).

**Community takeover (CTO).** For an abandoned coin, a community applies through a form; the team reviews
and, if approved, uses the owner's `setCreatorFeeRecipient` override: a **3-day timelock**, then a **3-day
execution window** in which anyone can execute, cancellable by the owner during the wait. It only moves
where future creator fees go; supply, pricing and locked liquidity cannot change. Approval is administrative,
not an endorsement.

**Migration (bringing a coin that pons did not launch).** Holders deposit the old coin into epochs: epoch 1
credits 1:1, later epochs credit less; each epoch can have a deposit cap, the last cap filling closes the
window. Deposits are withdrawable in full until the first sale; the keeper sells them in paced tranches with
a minimum output. Claims mint the new coin and vest linearly over "a few days"; claims stay open 90 days.
If the migration fails, depositors in unsettled epochs reclaim their share after a settlement deadline.

**Quote assets (v2).** Native ETH by default; the owner approves ERC-20 pairs with their own curve economics
in the asset's decimals: USDG, cbBTC and tokenized US stocks (NVDA, AAPL, HOOD and others). The pair is the
launch's currency for buying, graduation and creator payouts. Roughly a third of pons coins were stock- or
RWA-paired; the flagship was Artificial Inu paired with NVDA. Not available on Elysium (no such assets
there), so our version is HYPE only.

**Launch access.** `canLaunch(address)`: a global public switch plus a whitelist. Public launching was closed
at times; on 2026-10-29 the factory answered `canLaunch(0x0) = true`, so it was open.

**v1 (legacy, still trading).** No curve: a launch went straight into a Uniswap **v3** WETH pool with the
supply as liquidity, 1% pool fee, 0.0005 ETH launch fee, "graduation" at 4.2 WETH paired with no migration,
launch protection for two blocks (only the creator's buy in the launch block; then max 5% of supply held and
5.5% bought per wallet), 90/10 creator/protocol split. v2 replaced the opening-price problem with the curve.

**The app (ponsfamily.com).** Explore, Analytics, Create, token pages, fee claiming; it is a plain front end
over the contracts and an indexer. The docs state there is no pons API in the trust path and tell integrators
to index on-chain events (`TokenLaunched`, `CurveBuy`/`CurveSell`, `LaunchSwept`, `PoolGraduated`, `Swap`,
`HookFeeCollected`, the escrow's `Credited`/`Claimed` and token variants, the vault's `Locked`/`Released`).
Third parties (Bitquery, Mobula, Axiom-style terminals) index it the same way.

**Safety and trust posture.** Contracts immutable (new versions ship as new addresses); fee terms frozen per
launch; supply fixed; liquidity locked with no unlock; the owner keeps: fee policy for future launches
(protocol share max 50%, hook fee max 10%), the sweep operator, pair approvals, the whitelist, the CTO
override (timelocked), and delayed rescue paths (7 days) for stuck graduations. v2 audits by SB Security,
Dingbats and Pashov were in progress and unpublished as of the docs.

**What made it grow (from the research notes).** The 70/30 split paid continuously in the quote asset,
the atomic launch-and-buy, Robinhood Chain's zero-gas window (July to late September 2026), and the
stock-paired launches. Peak: $5.34M fees in a day (Aug 30, 2026), ~20K launches a day, 1.55% of coins
graduating. Revenue fell to a few percent of peak by October, like every launchpad surge before it.

## 10. Does Elysium have everything a Pons-style launchpad needs? Checked on chain, 2026-10-29

Elysium: chain id 99901, RPC `https://rpc-live.boxa.pro`, an Arbitrum Orbit (Nitro, ArbOS 61) rollup whose parent
chain is HyperEVM (999). Native gas coin HYPE, 18 decimals.

| Need | Pons uses | Elysium | Status |
|---|---|---|---|
| EVM with Cancun (v4 needs TSTORE/TLOAD; solc 0.8.26+) | Robinhood Chain (Orbit) | TSTORE, TLOAD, PUSH0 all execute (state-override call test) | OK |
| Uniswap v4 PoolManager | canonical v4 | `0x06c6…b2c4` is byte-for-byte the canonical v4 PoolManager build (only the self-address immutable differs); 1,502 swaps and 37 pool inits in the last 10k blocks; `fee 0 / tickSpacing 200 / hook` pools already exist there | OK |
| Native coin as the quote (address 0 = currency0) | native ETH | all 37 recent pools use native HYPE as currency0 | OK |
| Hook address mining (CREATE2 deployer) | yes | `0x4e59…956C` present (69 bytes) | OK |
| Permit2, Multicall3 | yes | present and responding | OK |
| Wrapped native | WETH (v1 only) | WHYPE `0xba87…5e81` present; not needed for the Pons design (native quote) | OK |
| v4 PositionManager (Pons mints the locked position as an NFT) | yes | **none found** | Design change: our locker holds the full-range liquidity directly in the PoolManager (`modifyLiquidity` + `unlockCallback`), no NFT, no remove function. Simpler and still permanently locked. |
| Contract size limit 24,576 B | Pons factory is 24,177 B | standard; a 12.8 KB deploy estimates 6.0M gas, accepted | OK (we split like Pons does anyway) |
| Gas cost | ETH | 0.1 gwei flat; a 20M-gas deploy costs 0.002 HYPE; L1-data part negligible (1.36 gwei/byte) | OK, almost free |
| Direct transaction submission | sequencer | `eth_sendRawTransaction` goes to the sequencer directly (a tx from our empty deployer was queued, not refused); Boxa's "queued-inbox / 2M gas" mode is only their own relayer path | OK |
| Block time and timestamps | about 0.25s blocks, 1s timestamps | **about 4.2s blocks**, timestamp deltas 1s to 7s | Pons' 3-second snipe tax would only ever hit the launch block itself. **Our snipe tax must count blocks** (e.g. launch block 99%, next block ~6%, then 0) or use a 10 to 15 second window. |
| Indexer: `eth_getLogs` | unlimited-ish | **max 10,000 blocks per request**; 20 parallel calls in 174 ms, no rate limit seen | OK, set `maxRange` 10,000 |
| Price in USD for the UI | ETH price | no on-chain oracle; use CoinGecko HYPE like the Ink `priceAs` path | OK |
| Bridging HYPE in | ETH already on chain | HyperEVM inbox `0xce59…2cff` (standard Arbitrum Inbox, `depositEth()`, allow list off, not paused; estimate 92,957 gas); Boxa's site has /bridge and /deposit pages | OK |
| Bridging HYPE out | n/a | `ArbSys.withdrawEth` on Elysium; rollup `0x508C…D217` confirm period 483,840 HyperEVM blocks = **about 5.5 days** | OK but slow (no fast bridge seen) |
| Block explorer / contract verification | Blockscout + Sourcify | **none public**, Elysium is not on chainlist or Sourcify | Gap: publish source on GitHub and keep a verifiable build; cannot show "verified" on an explorer |
| Chain operator risk | Robinhood (Offchain Labs stack) | Boxa runs the sequencer and the only RPC; chain owner is a Boxa key; chain is 10 days old (first block 2026-10-19) | Risk to accept: if Boxa stops, the launchpad stops |
| Sweep operator and graduation keeper | Pons runs bots | we run the same two bots (our launch service already does this for Equo) | OK |
| Stock / stablecoin pairs | NVDA, AAPL, USDG, cbBTC | none on Elysium | HYPE only |
| Our deployer `0xA078…aF0a` | | 0 HYPE on Elysium, 0 on HyperEVM; one 0-value tx from it is sitting in Elysium's mempool at nonce 0 (harmless, mines when funded) | needs about 0.05 HYPE on HyperEVM to bridge and deploy |

Boxa's own hook, for reference, uses beforeInitialize, beforeAddLiquidity, beforeRemoveLiquidity, beforeSwap,
afterSwap and both swap return-delta flags on this PoolManager, so every hook flag our design needs is proven
to work there.

Verdict: everything the Pons mechanism needs exists on Elysium except a v4 PositionManager (not needed with a
direct-liquidity locker) and an explorer. Two design adjustments: block-based snipe tax, and the locker holding
liquidity itself. Everything else carries over one to one with HYPE as the quote asset.
