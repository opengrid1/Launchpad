# Equo site

Static front end for Equo, a launchpad on Ethereum mainnet where every coin is paired with a tokenized real stock (Ondo "on" tokens such as TSLAon, NVDAon, SPYon) or with ETH. One Uniswap v4 pool per coin, liquidity held by the factory with no withdraw path, a flat 1 to 3% fee paid in the paired asset, optional anti-snipe and holder rewards.

It runs against the OneHook v2 contracts on mainnet (see `config.js`); `stocksOnly: true` keeps ETH-paired coins launched on the same factory off this site. The stock list in `config.js` carries each stock's ETH route (WETH -> USDC -> stock) that the router uses for buys, sells and launch dev buys.

## Layout

- `index.html` (Home), `calls.html`, `analytics.html`, `launch.html`, `rewards.html`, `pools.html`, `token.html`, `profile.html` (Portfolio), `admin.html` (Operator): pages, each with its own `sp-<page>.js`. Calls need the Equo server (`INKY.api` in `config.js`); until it is set the composer is disabled and the feed shows a labelled example. Referral and cashback on Rewards are marked Soon until the next contract update. `docs/`: documentation (static HTML).
- `DESIGN.md`: the front-end contract (layout, `core.js` API, `chain.js` API, token fields). Read it before adding a page.
- `ui.css`: the design system. `core.js`: shell (top bar, stock tape, footer, mobile sheet), wallet state, chain boot, shared helpers.
- `config.js`: chain, contracts, RPCs, stock list with routes, admin. `chain.js`: contract reads, trade index, routes, wallet calls. `wallet.js`: wallet connection (Reown AppKit). `tv.js`: TradingView chart. `avatar.js`: wallet avatars. `data.js`: formatting helpers.
- `charting_library/` (gitignored): TradingView Charting Library, licensed, not in this repo. The deploy needs it next to `tv.js`.

## Deploy

Vercel static deploy of this folder with `charting_library/` copied in:

```
vercel deploy <dir> --prod --yes --archive=tgz --token $VERCEL_TOKEN
```

`vercel.json` holds the clean URLs and the `/token/:addr` rewrite.
