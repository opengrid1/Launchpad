# Equo windows (HyperEVM)

Equo on HyperEVM, paired with HYPE, with **windows**: a buy the buyer can undo for a full refund of what they spent on coins, until the window ends.

## Contracts

| File | What it is | Size (limit 24,576) |
|---|---|---|
| `EquoWindows.sol` | Holds every pool's liquidity as a list of segments (one Uniswap v4 position each), runs windows, the creator's launch buy and the admin's `collect`. The only contract that can add liquidity. | 21.9 KB |
| `EquoWindowHook.sol` | The Uniswap v4 hook: the coin's fixed fee (0.3% to 5%) on every swap in WHYPE, split between creator and platform (the platform takes the larger of 20% of the fee and 0.2% of volume), and the floor guard. | 8.5 KB |
| `EquoWindowFactory.sol` | Launches: the coin (a `LiqioToken` clone, 1B, 18 decimals), the pool at a $3,000 market cap from HyperCore's HYPE price (`LiqioOracle`), the optional launch buy. Admin: fee recipient, `collect`. Creator: two-step hand-over. | 9.2 KB |
| `EquoWindowRouter.sol` | Plain buys and sells in HYPE. A sell stops at the floor and returns what the pool could not take. | 3.9 KB |

## A window

- **Open.** `msg.value` = spend + the coin's fee on it + premium. The window lasts premium / (spend × 4%) days: 6 hours is 1% of the spend, 1 day 4%, 7 days 28%. Shorter than 30 minutes is refused; premium past 7 days is refunded.
  - The coins a swap of the spend would buy are taken out of the pool, starting at the step above the price (the step holding the price is left alone, so a window gets slightly fewer coins than a swap). The price does not move; the emptied steps are a "hole".
  - The coins and the HYPE stay in `EquoWindows`, outside the pool. No swap can reach them, and `collect` never touches them.
- **Undo** (the buyer, before it ends). Every wei of the spend comes back.
  - The parts of the hole still above the price get their coins back exactly; if the price never reached the hole, the pool ends exactly as it was.
  - Coins from parts the price has passed go into the step just above the price.
- **Keep** (the buyer any time; anyone after it ends). The buyer gets exactly the window's coins.
  - If the price never reached the hole: the coins go back into it and are bought out again with the spend, fee-free (the fee was paid at opening). The pool ends as after a plain buy, with no hole above the price.
  - Otherwise: the HYPE refills the parts of the hole below the price; any remainder goes into the step just below the price. Pushing the price up before someone else's keep never moves that HYPE above the hole.
- **Premium.** Either way it buys coins from the pool, and they are burned.
- The coin's fee on the spend is paid at opening, split like any swap fee, and never comes back.

## Admin collect

`factory.collect(token, bps, to, from, maxSegments)` removes `bps` of the liquidity of up to `maxSegments` segments, starting at `from` (anything at or below the floor starts at the floor). It returns where the next call should start: the pool's top when the whole list is done.

- It works in one call or page by page, so it fits a small block however fragmented the list gets.
- It never touches what open windows hold; those windows can still be undone in full afterwards (tested).

## Limits

- A window may take liquidity from at most 16 segments; a larger one is refused (`TooFragmented`), and the app should offer a smaller amount.
- The pool fee tier is 0 (the hook takes the fee); the tick spacing is 10 (0.1% steps).

## Tests

```bash
npx hardhat test test/v4/window.local.test.ts
```

A fresh local chain with the real PoolManager and HyperCore's precompile mocked. 11 tests:

- launch, with and without a launch buy;
- window open, undo and keep, before and after the price passes the hole;
- a keep after someone pushes the price up;
- premium bounds;
- `collect` across a fragmented list, in pages;
- three long random runs (150 steps each) with a paged `collect`.

Gas measured in the runs: launch under 2M; window open, undo and keep at most about 1.36M. HyperEVM small blocks hold 2M.
