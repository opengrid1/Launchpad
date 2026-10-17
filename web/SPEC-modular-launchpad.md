# Modular v4 Launchpad — technical spec (working draft)

A Uniswap v4 launchpad whose tech is a strict superset of DNA (genomedna) and 00Geno:
one **immutable safety core** that every coin inherits, plus **hot-swappable mechanic
modules** called read-only and clamped to constitutional bounds. Coins can launch
**frozen** (modules locked, like DNA/00Geno) or **evolving** (modules swappable within
bounds). The money and the invariants always live in the immutable core; modules can
only *recommend* inside limits the core enforces.

## What we take from each (proven, in production)

From **DNA**:
- Immutable hook + a "constitution": hard fee cap, fixed platform fee, canary bound.
- Fee logic as an **external module** called via gas-capped `STATICCALL`, result clamped,
  fail-closed to baseline on revert/OOG/wrong-size return.
- **Shadow / canary** testing: try a candidate module on live swaps (shadow = emit only;
  canary = apply in a bounded window) before promoting it to active.
- A **circuit breaker** that counts module failures over a block window.

From **00Geno**:
- Launch straight into a v4 pool, **no bonding curve, no migration**: whole supply as
  single-sided liquidity in two positions (curve + tail), NFTs held forever by a locker.
- Graduation = price crossing a tick (continuous, no event).
- **Token-level rules** (the EVM transfer-hook equivalent) that see the real sender/
  recipient, up to N, that can only be *removed* (never added) — holders know the worst case.
- Linked launches: **sync pair** and **locked twin**.
- Dynamic LP fee set by the hook; fee split to creator / buyback / treasury / dividends.

## Where we are better (the actual tech upgrades)

1. **Everything is a module, not just the fee.** DNA only swaps the fee; 00Geno can only
   remove rules. Here fee policy, anti-snipe, rewards/dividends, vesting, max-wallet, and
   split are all modules behind the same bounded `STATICCALL` interface. The platform ships
   new mechanics forever **without redeploying the hook** — we ride every new meta with one
   audited core.

2. **Per-coin frozen vs evolving, by choice.** A creator picks "immutable mode" (modules
   frozen at launch, identical trust story to the competitors) or "evolving mode" (modules
   swappable within the constitution, by the creator or a timelock). 00Geno forces "rules
   only removable"; we offer both ends of the spectrum.

3. **Anti-sandwich in the core, not as a tax.** 00Geno *taxes* sandwiches after the fact.
   We *prevent* them at the base: one swap per `tx.origin` per pool per block (as in
   cntrl-z), enforced by the immutable core so no module can turn it off.

4. **Multi-pair, pair-agnostic.** Reuse the cntrl-z oracle: pair with ETH, tokenized gold,
   or any of the 573 Ondo tokenized stocks. DNA and 00Geno are ETH-only.

5. **Provable non-ruggability regardless of modules.** The immutable core guarantees, for
   every coin, no matter what modules are attached: cannot mint, cannot block a sell,
   cannot exceed the fee cap, cannot touch locked LP, cannot pause transfers. Modules are
   `STATICCALL` only — they never hold funds or move tokens. "Upgradeable features,
   un-upgradeable safety."

## The immutable core — hard invariants (the constitution)

- `MAX_TOTAL_FEE` (e.g. 5%). Any module fee result is clamped to this at the source.
- Platform fee is a fixed constant; a protocol fee (if ever enabled) comes out of treasury.
- The hook never calls `swap` / `modifyLiquidity` / `unlock`; it never blocks liquidity
  removal (`beforeRemoveLiquidity` can only read).
- One swap per `tx.origin` per pool per block.
- Launch LP is minted to the locker (or `0xdEaD`) and is unremovable; only fees are collected.
- The token has no owner, no mint, no pause, no transfer tax; mechanics live in the pool
  hook + optional token-rule modules, and token rules can only be removed.
- Module calls: gas-capped `STATICCALL`, 32-byte return only, clamp + fail-closed to
  baseline, failure counter → breaker.

## Module interfaces (all pure/view, `STATICCALL`)

- `IFeePolicy.feeBps(ctx, params) -> uint24` (clamped to MAX_TOTAL_FEE).
- `ISplitPolicy.split(params) -> (creator, buyback, treasury, rewards)` (sum == 10000, each in bounds).
- `IGateModule.check(from, to, amount, ctx)` (token-rule: anti-snipe window, max wallet,
  airdrop mode, official-pool-only) — reverts to block, bounded by core.
- Registry holds `active / canary / shadow` per module slot, per pool; a timelock or the
  creator rotates them in evolving mode; frozen mode locks them at launch.

## Launch flow

1. Deployer mines a salt so `token < pair` (coin is currency0 side we standardize).
2. Factory deploys the token (fixed 1B supply) with chosen token-rule modules.
3. Open the v4 pool with the immutable hook; put the whole supply as curve + tail
   single-sided liquidity; NFTs to the locker.
4. Optional creator first buy in the launch tx (anti-snipe module active from block 0).
5. Register the coin's module route (frozen or evolving) in the registry.

## First milestone (mirrors how cntrl-z was built)

- `Core` hook (invariants + module dispatch + breaker + anti-sandwich).
- `ModuleRegistry` (routes, frozen/evolving, timelock).
- Two modules: `LaunchDecayFee` (3%→baseline over 1h) and `AntiSnipe` (first-minute tax + gas cap).
- `Factory` + `Locker` + `Token`.
- Mainnet-fork tests (real v4 PoolManager + oracle), gas report, then deploy + verify + renounce.

## Open decisions (need your call)

1. **Brand/name** (DNA/genome theme is taken — pick something distinct).
2. **Pairs**: ETH only to start, or ETH + RWA set from day one (more work, bigger edge).
3. **Default mode**: lead with "frozen" (max trust) or "evolving" (max flexibility) as the
   headline, with the other as an option.
4. **First modules** beyond fee + anti-snipe: rewards/dividends? vesting? max-wallet?
