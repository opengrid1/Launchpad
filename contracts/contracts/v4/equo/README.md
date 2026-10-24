# Equo contracts (v3)

Equo is the next version of the OneHook contracts that run the launchpad on Ethereum mainnet today
(`contracts/v4/onehook`, deployed 2026-10-17, see `deployments/onehook-mainnet.json`). The v2 sources
are untouched: they are what is verified on Etherscan. Equo lives here as a separate set of contracts
with new names, so both can compile side by side.

An earlier build of these contracts was deployed on 2026-10-20 (`deployments/equo-mainnet.json`)
without `collect` and `setStartCap`. The current source is not deployed; using it needs a new deployment.

## What the live v2 contracts do

- One Uniswap v4 pool per coin, fixed 1B supply, the whole supply seeded as one position the factory
  holds and can never remove.
- One hook for every pool: fee engine (flat, dynamic, MEV-tax), anti-snipe, buyback and burn,
  holder dividends, max wallet, evolution stages. Fee caps are enforced in the hook itself.
- Fee split: buyback and dividend shares first, then 60% creator and 40% platform.

## Review of v2: what the site needs that v2 cannot do

| Site feature | v2 status | Why |
|---|---|---|
| Referral earnings | Missing | The hook has no notion of who traded or who referred them. |
| Cashback | Missing | Same: no trader identity, no per-user balance. |
| Takeover | Missing | The creator is fixed at launch; no function changes it. |
| Creator transfer | Missing | Same. |
| Creator edits coin info | Missing | Only the admin can override metadata. |
| Start cap presets | Missing | One global start cap, set by the admin. |

Other findings (no change needed):

- `payCreator` can be called by anyone and always pays the current creator, so creator fees are never stuck.
- Max wallet counts per `tx.origin`; smart wallets relayed by one bundler share its allowance for the window. Documented in the hook.
- The deployed OneHook factory (`0xBaa0…1E39`) has an admin-only `collect` that pulls a share of a
  coin's launch position to a recipient. The repo's OneHook source had it removed after that deploy,
  so the source and the live bytecode differ. Equo restores it 1:1 (see below).

## What v3 adds

### Hook (`EquoHook`)

- **Cashback and referral.** Out of the platform's 40% only, `cashbackBps` goes to the trader and
  `referralBps` to the trader's referrer. Creator share, buyback and dividends are unchanged. Each is
  capped at 50% of the platform part. Rewards accrue per user and pair asset as PoolManager claims and
  are paid by `claimRewards(pairs)` (ETH on a WETH pair).
- **Trader identity.** The router (and the factory, for the creator's first buy) names the trader and
  referrer in hookData. Anyone else trades as `tx.origin`, with no referrer binding.
- **Referrer binding.** Once per trader, only through the router, never to the trader themselves.
- **Mutable creator.** `setCreator` exists but only the factory can call it.

### Router (`EquoRouter`)

- `buy`, `sell`, `buyWithPair`, `sellForPair` take a `referrer` (zero for none) and pass the trader to the hook.

### Factory (`EquoFactory`)

- **Start cap presets.** `setCapPresets` (admin, 1 to 4 values, $1,000 to $1,000,000). Each launch
  passes `capPreset`. `capOf(token)` records the cap used.
- **Creator metadata.** `setCreatorMetadata` by the current creator. Display order: admin override,
  then creator metadata, then the coin's own.
- **Creator transfer.** `transferCreator` then `acceptCreator`. The old creator is paid what they are
  owed before the role moves.
- **Activity.** `poke`, `claimCreatorFees`, metadata edits and transfers mark the creator active.
- **Community takeover.**
  - Allowed once the creator has been idle for 30 days.
  - The proposer locks at least 5% of the supply. A bigger stake replaces a running proposal; the
    earlier stake is returned and the 7-day clock restarts.
  - The creator can cancel at any time during the 7 days, and any creator action blocks execution.
  - After 7 days anyone calls `executeTakeover`: the old creator is paid, the role moves, the stake returns.
- **Reward split.** `setRewardSplit` (admin) forwards to the hook.
- **OneHook admin levers, 1:1 with the deployed OneHook factory.** `pause`, `resume`, `setHidden`,
  `setCoinMetadata`, `setFeeRecipient`, `setTokenBlocked`, `pushPlatformFees`, `setConverter`,
  `renounceOwnership`, `setStartCap` (sets the default preset, $1,000 to $100,000), and `collect`
  (admin-only, pulls `bps` of a coin's launch position to a recipient, emits `Collected`, never
  touches fee pots or rewards).
- `genesOf` and `stagesOf` are read from the hook only; the factory no longer duplicates them, to stay
  under the contract size limit.

## Not in v3, and why

- **Fees into liquidity.** Adding pair tokens to the pool needs a single-sided position below the
  price and a policy for when to add. It is a separate design and adds risk to the liquidity code,
  which v2 keeps deliberately minimal.
- **Time-weighted holder rewards.** Needs balance checkpoints in the coin. Current dividends are
  pro-rata to balance, which is standard and cheap.
- **Unclaimed creator fees swept to a buyback.** Not needed: anyone can push creator fees, and a
  takeover handles abandoned coins.
- **Calls, alerts, notifications.** Backend features, no contract involved.

## Decisions needed before deploying

| Setting | Proposed | Notes |
|---|---|---|
| Cashback | 25% of the platform part | 0.1% of a 1% fee with no pots. |
| Referral | 25% of the platform part | Same. |
| Start cap | $3,000 (default preset) | Admin can change later with `setStartCap` or `setCapPresets`. |
| Minimum first buy | 0.001 ETH on Ethereum; per chain elsewhere (`EQUO_MIN_FIRST_BUY`) | Factory immutable. A launch with less reverts `FirstBuyTooSmall`, on `launch` and on `launchFor` alike, so the launch service seeds every chain's pool. No pool ever starts empty, which is what made scanners and trading bots read fresh coins as honeypots on Liqio. |
| Takeover idle time | 30 days | Constant. |
| Takeover delay | 7 days | Constant. |
| Takeover minimum stake | 5% of supply | Constant. |

## Known trade-offs

- A trader can refer themselves through a second wallet. The most they gain is the referral share of
  the platform's part of their own fee.
- The proposer with the biggest stake wins a takeover. A staked coin earns no dividends while locked.
- The admin can move the cashback and referral shares within the caps. It only re-splits the
  platform's own part.
- The creator must act through the factory (`claimCreatorFees`, `poke`) for the idle clock to reset.
  Claiming directly on the hook still pays them but does not count as activity.

## Tests

```
npx hardhat test test/v4/equo.local.test.ts test/v4/equo-v2-invariants.local.test.ts
```

Both run on a local chain with the real Uniswap v4 PoolManager. The second file is the v2 test suite
run against the Equo contracts.

## Sizes

| Contract | Bytes (limit 24,576) |
|---|---|
| EquoHook | 17,319 |
| EquoFactory | 24,084 |
| EquoRouter | 8,313 |
| EquoTokenDeployer | 19,357 |

## Deploying

Rehearse locally first:

```
DRY_RUN=1 EQUO_CASHBACK_BPS=2500 EQUO_REFERRAL_BPS=2500 EQUO_CAP_PRESETS=5000,12500,25000 npx hardhat run scripts/deploy-equo.ts
```

Mainnet needs `EQUO_CONFIRM_MAINNET=1` plus the usual `ONEHOOK_ADMIN`, `ONEHOOK_ORACLE` and deployer key.

Migration: coins launched on v2 stay on the v2 contracts forever (their liquidity cannot move). The
site has to read both factories, send new launches to Equo, and route each coin's trades to the router
that matches its factory.
