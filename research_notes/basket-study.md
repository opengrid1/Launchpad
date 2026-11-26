# Basket (basketlaunch.xyz): what it does, and our Robinhood Chain build

Studied 2026-11-25 from the live site (Board, coin page, Create, Rewards, Airdrops, Baskets, Mint, How it works).
Feature parity only: our own code, design and brand. No "Robinhood"/"Hood" in names.

## What Basket is

A Solana launchpad on Raydium LaunchLab whose coins pay their holders. 87 live coins, $BASKET ~$1.1M mcap,
$13K paid to holders, ~$349K volume per 10-hour airdrop round.

### Launch
- Creator picks the **quote** (SOL, USDC, or custom: 366 tokenized stocks/crypto, selected Basket memes) and the
  **reward** (what holders are paid in; up to 10, paid in turns, each until paid out).
- ~0.04 SOL (rent + 0.01 SOL launch fee). Dev buy required (>= 0.1 SOL), in the launch transaction.
- Creator may hold at most 2% at listing; launch-block buyers never get rewards or airdrop credit.
- Ticker 2-10 chars, case-insensitive, first launch free; a copy costs 1 SOL (first hour) / 0.5 SOL after, refunded if
  the copy graduates within 48 h.
- 1B supply, mint/freeze revoked, metadata on IPFS (immutable).

### Trading
- Bonding curve from ~$9.3K to ~$70K mcap, then a Raydium pool with the LP locked forever.
- Buy with SOL; routed SOL -> quote -> coin when the quote is not SOL. Tradable in Axiom/GMGN/Jupiter too.
- Fee 2% on the curve, 1.25% after graduation:

| | Holders | Burn $BASKET | Basket | DEX |
|---|---|---|---|---|
| SOL curve, before | 0.25% | 0.25% | 1.25% | 0.25% |
| SOL curve, after | 0.33% | 0.33% | 0.54% | 0.04% |
| Other curves, before | 0.5% | - | 1.25% | 0.25% |
| Other curves, after | 0.67% | - | 0.54% | 0.04% |

### Holder payouts (the core feature)
- Each coin: a round every 5 minutes from its launch minute. The holders' share is swapped into the current reward and
  pushed to the top 5,000 holders by balance, no claim. Pools/program accounts and launch-block buyers excluded.
- Pays only once >= $5 has built up; shares < $1 carry over; collect only when worth 2x the network fee.
- A few hundred payments per round; overflow paid next round in random order.
- Balances read at payout time (sold = nothing).

### Trader airdrop
- 10% of platform revenue -> pot; every 10 hours paid in SOL to the top 500 traders by volume (buys + sells, any app).
- #1-3: 5.3% / 4% / 3%; #4-20 share 13% by volume; rest by volume (capped at 75% of the smallest top-20 share).
- Min $50 volume; max 10% of a pot per wallet; coins sold/sent within 2 minutes don't count; wash traders dropped.

### Revenue split and extras
- Platform revenue: 25% to an NFT pot, then 10% airdrop pot, 45%/45% two owners.
- Basket NFTs: 1,000, mint burns 100K $BASKET + 0.5 SOL (0.45 to existing NFT vaults). Hourly the pot spends 5% on the
  day's token (rotation SPYx > NVDAx > TSLAx > QQQx > $BASKET) and splits it equally into every NFT's vault.
- $BASKET: SOL-curve coins burn it with half the holders' share.

### UI quality notes
- Dark navy, single accent blue, green buy. Left sidebar nav (Trade / Earn / Learn), top search, token price chip.
- Board: big hero, tabs Trending/New/Final stretch/Graduated, filter chips (Paired, Basket coins, Pays RWA, Pays crypto),
  3-column cards with a large faded logo, mcap, "Paired to X", "Pays Y".
- Coin page: stats row (mcap, price, price in quote, curve %), candle chart with 1m-1d and mcap/price toggle, trade
  panel (presets, slippage, route "SOL -> X -> coin"), curve bar, details, "Where every fee goes", holder-rewards panel
  with payout wallet, current reward and "waiting for $5 ($4.79 so far)".
- Rewards page: "you're earning on", list of coins paying now with 24 h payouts.

## Our build on Robinhood Chain (chain 4663)

- Uniswap v4 PoolManager is live there (Pons uses `0x8366a39c…0951`); 50 stock tokens tradable via USDG; gas ~0.02 gwei
  (a 200-holder payout batch is ~$0.26).
- Curve + graduation: our v4 hook stack (as Hypex/Pons), LP held and locked by our locker; pairs ETH, USDG, stocks.
- Holder rewards, trustless: the coin token keeps a reward-per-token accumulator per reward token (updated on every
  transfer, so balances are exact); excluded addresses (pool, PoolManager, hook, launch-block buyers) earn nothing.
  The keeper converts the holders' pot into the current reward (bounded swap) and then pushes payouts with a
  permissionless `claimFor(holder)` that can only pay the holder. Same no-claim UX, no trusted payout wallet.
- Trader airdrop: indexer ranks volume per 10-hour round; Merkle root posted on chain, keeper pushes the transfers.
- Platform token + NFT vaults: phase 2.
