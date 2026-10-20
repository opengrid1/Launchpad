# StockPad front end: design and conventions

StockPad is a launchpad on Ethereum where every coin is paired with a tokenized real stock (TSLAon, NVDAon, ...) or ETH. The front end is static HTML + vanilla JS. This file is the contract every page follows. It is deliberately not the OneHook layout: no hero wordmark page, no trending sidebar, no sticker chips.

## Look

Original design, "The Exchange": an editorial-finance look that no launchpad uses. Cream type (`--fg #f1ede6`) on graphite (`--bg #0a0a0b`), Instrument Serif for headlines (italic coral for the emphasised word), Inter for UI, JetBrains Mono for every figure, label, address and symbol. One coral accent (`--ac #ff5a3c`) for actions and emphasis; green and red only for market direction.

Data is laid out as ledgers and boards, never as grids of stat boxes or cards:
- `.ledger` / `.lr`: label, dotted leader, mono value, optional `small` sub-value. Used for the session panel, token stats, order ticket details, the launch prospectus and the statement totals.
- `.strip` / `.ti`: the ticker strip of stocks under the masthead, which doubles as the stock filter.
- `.board` / `.bh` / `.br`: the coin board, one row per coin with the avatar (`.av2`, the paired stock's logo pinned to its corner), the pair with the live stock price and NYSE status, price, market cap, volume, holders, a 24h sparkline and a Trade button.
- `.steps3` numbered serif steps, `.band` coral call-to-action band.

Shell: 64px top bar with the serif wordmark, text navigation with an underline, the NYSE clock with a countdown (`.clock`), Launch and Connect wallet. A three-column footer with the contract addresses. Below 640px the navigation becomes a bottom tab bar (`.tabbar`). Token page: serif masthead with a big mono price, two ledgers of stats, flow and fee-split bars, chart, text tabs, and an "order ticket" on the right. Launch page: numbered sections (Identity, Pair, Terms) next to a "prospectus" ledger. Portfolio is a "statement".

All classes live in `ui.css` (read it; use its classes before inventing new ones). Page-specific CSS goes in a `<style>` block at the top of that page's HTML, scoped with the page's root id.

## Page skeleton

```html
<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>... | StockPad</title><meta name="description" content="...">
<link rel="icon" href="/img/favicon.svg?v=12" type="image/svg+xml"><link rel="apple-touch-icon" href="/img/apple-touch-icon.png?v=12"><meta name="theme-color" content="#0a0a0b">
<meta property="og:image" content="/img/og.png?v=12">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap">
<link rel="stylesheet" href="/ui.css?v=6">
<style>/* page css, scoped under #pg-<name> */</style>
</head><body data-page="<name>">
<header id="sp-top"></header><div id="sp-tape"></div>
<main id="sp-main"><div class="wrap"><div id="pg-<name>">...page markup...</div></div></main>
<footer id="sp-foot"></footer>
<script src="/config.js"></script><script src="/data.js"></script><script src="/avatar.js"></script><script src="/chain.js"></script><script src="/wallet.js"></script><script src="/core.js?v=6"></script><script src="/sp-<name>.js?v=6"></script>
</body></html>
```

`core.js` renders the top bar, the footer and the mobile tab bar on every page (the `#sp-tape` element stays in the skeleton but is unused), boots the chain layer, and then calls `window.SP_PAGE()` which each page script defines. Pages never touch the shell elements.

The token page also loads `/tv.js` and `/charting_library/charting_library.js` (see token page notes).

## core.js API (globals)

- `$`, `$$`, `esc(s)`, `ic(name, cls?)` icons: search plus wallet copy ext check x chevr up down globe user logout shield book rocket candle swap lock info clock filter grid list trend arrow back.
- From `data.js`: `fmtPrice(n)`, `fmtUsd(n)`, `fmtAmt(n)`, `fmtEth(n)`, `ago(secs)`, `ageStr(age)`, `shortAddr(a)`, `cs(a)` checksum, `pairImg(sym)`, `tokenUrl(x)`, `LIVE`, `TOK` (visible tokens array, kept fresh), `SUPPLY` (1e9).
- `SP.ready()` promise: resolves once the chain layer has loaded; `SP.onUpdate(fn)` runs after every background refresh (new trades, prices).
- `SP.tokens()` visible tokens; `SP.token(addr)`; `SP.stocks` (config stocks: symbol, ticker, name, address, logo, decimals, route); `SP.stockBySym(sym)`, `SP.stockByAddr(addr)`; `SP.prices[addrLower]` USD price cache for stocks and WETH, filled at boot; `SP.pairUsd(addr)` promise; `SP.ethUsd()` promise.
- `SP.market()` → `{open:boolean, label:'Market open'|'Market closed', detail:'Closes 4:00 PM ET'|'Opens Mon 9:30 AM ET'}` from NYSE hours in America/New_York.
- `SP.coinLogo(x)`, `SP.stockLogo(symbol)` → url; `SP.avatar(addr, size)` → svg html.
- `SP.W` wallet: `{connected, address (lowercase), short, chainOk, connect(), disconnect(), switchChain()}`; `SP.onWallet(fn)` fires on every change. `SP.isAdmin()`.
- `SP.toast(msg, kind='ok'|'err'|'info')`, `SP.dialog(title, bodyHtml)` → overlay element (`.ov`, call `.remove()` to close), `SP.closeDialogs()`, `SP.menu(anchorEl, html)` → menu element.
- `SP.go(url)`, `SP.errMsg(e)` (wallet rejection → "Transaction cancelled"), `SP.copy(text, msg)`.
- `SP.fmtPct(v)` → html span with sign and class, `SP.fmtPair(v, x)` → "0.013 TSLAon" or "0.013 ETH", `SP.usd(v)`.
- `SP.fmtDate(ts)`.

## chain.js API (window.CHAIN), all async unless noted

Reads: `tokens()` (sync, all tokens), `token(addr)` (sync), `trades(addr)` → trade items, `allTrades()`, `tradePrice(t)` (sync, pair per coin), `bars(addr, stepSecs, from, to)`, `holders(addr, n)` → `[{wallet, bal, share, name}]` sorted desc (first row is usually the pool, wallet === poolManager), `topTraders(addr)` → `[{wallet, pnl, volume, trades, bought, sold, holding}]`, `pairUsd(addr)`, `ethUsd()`, `feeBps(addr)`, `balance(addr, wallet)` BigInt coin balance, `ethBalance(wallet)` BigInt, `pending(addr, wallet)` BigInt holder rewards claimable (pair units), `position(addr, wallet)` → `{avg, units}`, `profile(wallet)` → `{trades, holdings:[{x, bal, avg, pend, pendUsd}], created:[{x, fees}]}` (fees = creator fees claimable in pair units), `quoteBuyEth(addr, weiIn)` → BigInt coin out, `quoteSellEth(addr, coinWeiIn)` → BigInt ETH out, `startCapUsd()`, `launchesPaused()`, `pairs()`, `stocks`, `symbolOf(addr)`, `explorer`, `checksum`, `isAddress`, `parseEther`, `formatEther`, `refresh(addr?)` → re-reads and returns the token.
Writes (each returns the mined receipt; they throw on rejection): `buy(addr, weiIn, minCoinOut)`, `sell(addr, coinWeiIn, minEthOut)`, `launch(params, devWei)` → `{rc, token}`, `claim(addr)` holder rewards, `payCreator(addr)` pays creator fees to the creator, `pushDividends(addr)`.
Launch params: `{name, symbol, metadataURI (JSON string: description, image data URL, website, x, telegram), pair (address; WETH for ETH), minPairOut:0, genes:{feeMode:0, feeBps (10..300), snipeBps (0 or feeBps+1..3000), snipeBlocks (0 or 5..7200), buybackShareBps:0, buybackThreshold:0n, divShareBps (0 or 100..5000), maxWalletBps:0, maxWalletSecs:0, evolution:{enabled:false}}}`.

Token object fields: `addr` (lowercase), `n` name, `t` symbol, `pair` (pair symbol: 'ETH' or 'TSLAon'), `pairAddr`, `pairUsd`, `px` (USD), `pxPair` (pair per coin), `mc` (USD market cap), `vol` (24h USD), `volAll`, `liq` (USD), `liqPair`, `h` holders, `traders`, `trades`, `c5`/`c1`/`c24` (% change), `feeBps`, `feeMode`, `rewards` (bool), `isDiv`, `creator` (lowercase), `createdAt`, `age` ('12m'), `img`, `desc`, `links{web,x,tg}`, `totalCreatorFees`, `totalHolderRewards`, `creatorOwed`, `platformOwed` (pair units), `hidden`, `poolId`, `genes`.
Trade item: `{token, wallet, buy, coin (wei string), pair (wei string), fee (wei string), block, ts, tx, index}`.

## Chart

`initTV(containerId, x)` from `tv.js` mounts the TradingView widget into the element with that id (needs `<script src="/charting_library/charting_library.js">` and the global `SUPPLY`). After each refresh call `tvTick(x.pxPair, newTrades)`. The widget needs a container at least 420px tall; use `TradingView` only if `window.TradingView` exists, otherwise show a plain notice.

## Writing rules

Plain, factual copy. Never say liquidity is burned or locked; say it cannot be withdrawn. Fees are paid in the paired asset. Do not mention OneHook, instincts, evolution or AI. Mobile first for every page: the nav collapses to a sheet below 900px, tables drop their `.hm` columns below 640px and scroll for the rest, grids stack.
