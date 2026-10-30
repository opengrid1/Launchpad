# Launchpad v4 on HyperEVM: final v1 logic

Decided 2026-10-30. Direct-to-pool Uniswap v4 launches in HYPE with Pons' fee economics, no bonding curve, no
graduation, no community takeover, admin powers 1:1 with Pons, plus a volatility fee. Name: to be given.

## 1. Launch (one transaction, about 1.2M gas, fits HyperEVM's 3M small blocks)

1. Token: EIP-1167 clone of one implementation. 1,000,000,000 supply, 18 decimals, EIP-2612 permit, no
   mint, no owner, no transfer tax, no blacklist. Address salt-mined to end in four zero nibbles.
2. Pool: Uniswap v4 (official PoolManager `0x12D4…6B1F`), token/HYPE (native), pool fee 0, tick spacing 200,
   our hook. Every fee is taken by the hook, never by the pool.
3. Liquidity: 100% of the supply minted into three positions through the official PositionManager at
   launch, from the starting price upward: 20% of supply from 50 to 200 HYPE market cap, 30% from 200 to
   1,000, 50% from 1,000 to the max tick. No team or creator allocation.
4. Lock: the three position NFTs go to the locker, which has no withdraw path; pool fee is 0 so there are
   no LP fees to collect. Liquidity is locked forever.
5. Opening buy: the creator may buy in the same transaction, capped at 5% of the supply; the hook's snipe
   tax exempts the creator for that buy only.
6. Launch fee 0.005 HYPE to the protocol fee recipient (owner-settable).
7. Metadata on chain (name, symbol, logo URI, description, socials) emitted in `TokenLaunched`; the
   description cannot contain links; nothing is editable after launch.
8. Launch form, same as Pons: step 1 Identity (image square up to 5 MB, name up to 32, ticker up to 10,
   description up to 256, X, Telegram, website); step 2 Economics (creator fee 0 to 10%, buyback on/off,
   opening buy amount); preview card; one wallet confirmation.

## 2. Fees

9. Base fee 1% of the HYPE side of every buy and sell, taken by the hook (afterSwap with return delta).
10. Split 70% creator / 30% protocol, snapshotted per launch from the factory's policy at launch time and
    frozen for that launch.
11. Optional creator tax 0 to 10% on top of the base fee, chosen at launch, frozen, shown on the token page.
    100% of it goes to the creator.
12. Optional buyback: when on, 50% of the creator's bucket buys the token on its own pool at sweep time and
    the tokens vest linearly to the creator over 5 years (Pons buyback vault). Chosen at launch, frozen.
13. Volatility fee (new): the hook keeps one reference price per pool, refreshed every 60 s. When a swap
    moves the price more than 10% from the reference within the window, in either direction, the fee rises
    to 3% and decays linearly back to 1% over 2 minutes; a new spike resets the decay. The extra fee follows
    the same 70/30 split and the same escrow. Thresholds (10%, 3%, 2 minutes) are owner settings for future
    launches, frozen per launch; the peak is capped by the hook fee cap (10%).
14. Escrow: fees accrue per launch in the hook, the sweep operator moves them into the fee escrow (pending
    thresholds, keeper), the creator and the protocol claim from the escrow any time. Claims are pull only.

## 3. Protection

15. Snipe tax in the hook: during the first 10 seconds after launch, buys pay an extra tax that starts at
    99% of the HYPE leg and halves fourteen times across the window (Pons formula, `startBps >> (elapsed *
    14 / window)`), reaching 0 at the end. Creator exempt. Proceeds follow the 70/30 split. Window and start
    bps are owner settings for future launches, frozen per launch.
16. The snipe window and the volatility fee do not stack: during the window only the snipe tax applies; the
    volatility reference price starts at the end of the window.
17. No bonding curve, no graduation, no migration, no pause of a live pool, no fee change on a live launch.

## 4. Creator

18. The creator is fixed at launch. No community takeover, no takeover page, no admin reassignment of the
    creator role.
19. The creator may change their own fee payout address (for a cold wallet). That is the only creator-side
    mutation.
20. Creator page: lifetime fees, pending fees, claim, buyback vest, opening-buy status.

## 5. Admin, 1:1 with Pons

21. Fee policy for future launches: protocol share up to 50%, hook fee up to 10%, creator tax cap, buyback
    share, snipe terms, volatility terms. None of it reaches a live launch.
22. Sweep operator, launch fee, launch enabled switch, creator whitelist, pair-asset approvals (v1 ships
    HYPE only; other quote assets can be approved later).
23. Creator-fee-recipient override with a 3-day timelock, and the delayed rescue paths, exactly as in Pons.
24. Ownable2Step on hook, factory, locker, vault, escrow. Owner 0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b.

## 6. Platform and operations

25. Keeper: fee sweeps once a launch's pending fees pass a threshold (default 0.5 HYPE), with the minimum
    outputs for buyback swaps; 1,000-block log pages on the public RPC, private RPC for production.
26. Indexer: TokenLaunched, Swap, HookFeeCollected, VolatilityFee, SnipeTax, escrow events; candles,
    trades, holders, creator earnings, fee state ("fee now 1.0%" / "volatility fee 2.4%, decaying").
27. Site: HyperEVM config (chain 999, hyperevmscan links), launch form as in item 8, token page with chart,
    trades, holders, fee state, lock proof (position ids in the locker), creator page, rewards page.
28. Platform token with buyback-and-burn from the 30% protocol share: not in v1; the protocol bucket is
    kept separate so it can be wired later without touching launches.

## 7. Chain facts the design depends on

29. HyperEVM small blocks 3M gas every second, big blocks 30M every minute. Users never need big blocks; the
    one-time stack deployment does (deployer toggles with `liqio-big-blocks.py`).
30. Base fee moves (10 to 150 gwei seen); all scripts take fees from the node. At 50 gwei a launch is about
    0.06 HYPE, a swap about 0.008 HYPE.
31. Uniswap v4 official on HyperEVM: PoolManager `0x12D4Fd9C5DeDd00ab8a0bCe2CF0167bbf94b6B1F`,
    PositionManager `0x0d7Ab5B3db668128Aff6F70C4eBC71D7d4DA9bf9`, Permit2 `0x0000…78BA3`, WHYPE
    `0x5555…5555`, CREATE2 proxy `0x4e59…956C` for the mined hook address.

## 8. What is reused and what is new

- Reused unchanged (byte-identical Pons v2, already proven on the HyperEVM fork): fee escrow, buyback vault,
  locker, the hook's fee accounting and sweep paths, the owner model.
- New: the launch factory (clone token, pool init, three positions, lock, opening buy, launch fee), the
  token implementation, the snipe tax and volatility fee inside the hook (Pons kept the snipe tax in the
  curve), the keeper without graduation, the indexer events, the site pages.
- Dropped: bonding curve, graduation executor, launch deployer, launch-and-buy forwarder, phase logic.
