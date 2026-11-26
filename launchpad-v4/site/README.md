# Launchpad site

Static front end for the launchpad in `../SPEC.md`: one coin on HyperEVM and Solana, HYPE pair on both, locked
liquidity, 1% fee with 70% to the creator, snipe tax, volatility fee. Vanilla HTML, CSS and JS, no build step.

- `config.js`: brand (one constant), the two chains, contract addresses (empty until deployed), the economics
  shown on the pages, `mode: 'demo' | 'live'`.
- `app.js`: shell (top bar, mobile tab bar, footer), wallets (injected EVM wallets through EIP-6963 with the
  HyperEVM switch/add; Phantom, Solflare and Backpack on Solana; a demo wallet when none is installed and the
  site is in demo mode), HYPE price from Hyperliquid's info API, gas from the RPC, toasts, dialogs, helpers.
- `demo.js`: the `DATA` interface on generated coins with a pool per chain, live trades every few seconds,
  the snipe window and the volatility fee simulated from the real formulas, and working launch, buy, sell and
  claim flows on a demo balance. `chain.js` (to write when the contracts exist) implements the same interface.
- `chart.js`: canvas chart (candles or line, market cap or price, USD or HYPE, ranges, chain picker).
- Pages: `index.html` + `pg-home.js` (stats, live feed, filters, coin cards), `launch.html` + `pg-launch.js`
  (two steps: identity, economics; live preview; one transaction), `token.html` + `pg-token.js` (header, stats,
  chart, fee state, trade panel per chain, trades, holders, liquidity positions, info), `creator.html` +
  `pg-creator.js` (fees and claim), `docs.html`.
- `vercel.json`: clean URLs and the `/token/:addr` rewrite.

Local check: `node scratchpad/site-test.cjs` style server (any static server with the rewrite) or
`npx serve`. Deploy: `npx vercel deploy launchpad-v4/site --prod --yes --token $VERCEL_TOKEN`.
