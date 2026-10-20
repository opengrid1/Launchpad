# StockPad site

Static front end for StockPad, a launchpad on Ethereum mainnet where every coin is paired with a tokenized real stock (Ondo "on" tokens such as TSLAon, NVDAon, SPYon) or with ETH. One Uniswap v4 pool per coin, liquidity held by the factory with no withdraw path, a flat 1 to 3% fee paid in the paired asset, optional anti-snipe and holder rewards.

It runs against the OneHook v2 contracts on mainnet (see `config.js`); `stocksOnly: true` keeps ETH-paired coins launched on the same factory off this site. The stock list in `config.js` carries each stock's ETH route (WETH -> USDC -> stock) that the router uses for buys, sells and launch dev buys.

## Layout

- `index.html`, `launch.html`, `token.html`, `profile.html`, `admin.html`: pages. `docs/`: documentation (static HTML).
- `config.js`: chain, contracts, RPCs, stock list, admin. `chain.js`: contract reads, trade index, routes, wallet calls. `app.js`, `pages.js`: UI. `wallet.js`: wallet connection. `tv.js`: chart. `avatar.js`: wallet avatars. `data.js`, `i18n.js`: static data.
- `charting_library/` (gitignored): TradingView Charting Library, licensed, not in this repo. The deploy needs it next to `tv.js`.

## Deploy

Vercel static deploy of this folder with `charting_library/` copied in:

```
vercel deploy <dir> --prod --yes --archive=tgz --token $VERCEL_TOKEN
```

`vercel.json` holds the clean URLs and the `/token/:addr` rewrite.
