# StockPad front end: design and conventions

StockPad is a launchpad on Ethereum where every coin is paired with a tokenized real stock (TSLAon, NVDAon, ...) or ETH. The front end is static HTML + vanilla JS. This file is the contract every page follows. It is deliberately not the OneHook layout: no hero wordmark page, no trending sidebar, no sticker chips.

## Look

Dense dark trading-floor look, StockPad's own: black page (`--bg #000`), bordered panels (`.panel`), mono uppercase labels (`.lab`), mini stat boxes (`.sbox`), badges (`.badge`), filter pills (`.pill`), one terminal-blue accent (`--ac #3fbcff`) with a glow on the primary action, green and red only for market direction. Inter for text, Space Grotesk for headings, buttons and pills, JetBrains Mono for numbers, labels, addresses and badges.

Signature pieces: every coin avatar carries the paired stock's logo pinned to its corner (`.av2` + `.stb`); coin cards show an area sparkline built from the trade index, a 24h buy/sell flow bar, the NYSE status and MCAP / VOL 24H / TRADES boxes; the top bar carries an NYSE clock with a countdown to open or close.

Shell: a 60px top bar with the wordmark, text navigation (underline on the active page), a search field, the NYSE clock, Launch and Connect; content in a 1320px column; a thin footer bar with the factory and hook addresses, docs links, the X handle and the ETH price. Navigation: Home, Calls, Analytics, Launch (centre, filled), Rewards, Profile, Docs. The header search hides below 1340px. Below 900px the navigation hides and a bottom tab bar (`.tabbar`) shows Home, Calls, Launch, Rewards and Analytics; Profile is in the wallet menu. Home opens with a headline, a sentence, two buttons and four stat boxes, then the filter bar (sort pills, stock pills with counts, search) and the coin cards with a pager. Launch is a single outlined form next to a live preview card.

All classes live in `ui.css` (read it; use its classes before inventing new ones). Page-specific CSS goes in a `<style>` block at the top of that page's HTML, scoped with the page's root id.

Pages: `index.html` (Home), `launch.html`, `calls.html` (composer, feed with return since each call, trending, top callers), `analytics.html` (volume, fees, trades and launches per day with bar charts, fee flows, breakdown by stock, top coins, top traders, top creators, live trade feed), `rewards.html` (holder rewards and creator fees across coins, buyback burns, referral and cashback marked Soon), `token.html`, `profile.html`, `admin.html`, `docs/`.

## Page skeleton

```html
<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>... | StockPad</title><meta name="description" content="...">
<link rel="icon" href="/img/favicon.svg?v=13" type="image/svg+xml"><link rel="apple-touch-icon" href="/img/apple-touch-icon.png?v=13"><meta name="theme-color" content="#000000">
<meta property="og:image" content="/img/og.png?v=13">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap">
<link rel="stylesheet" href="/ui.css?v=9">
<style>/* page css, scoped under #pg-<name> */</style>
</head><body data-page="<name>">
<header id="sp-top"></header><div id="sp-tape"></div>
<main id="sp-main"><div class="wrap"><div id="pg-<name>">...page markup...</div></div></main>
<footer id="sp-foot"></footer>
<script src="/config.js"></script><script src="/data.js"></script><script src="/avatar.js"></script><script src="/chain.js"></script><script src="/wallet.js"></script><script src="/core.js?v=9"></script><script src="/sp-<name>.js?v=9"></script>
</body></html>
```

`core.js` renders the top bar, the footer bar and the mobile tab bar on every page (the `#sp-tape` element stays in the skeleton but is unused), boots the chain layer, and then calls `window.SP_PAGE()` which each page script defines. Pages never touch the shell elements. `core.js` also provides the watchlist (`SP.watch`, `SP.star(addr)`, stored per browser) and the shareable PnL image (`SP.pnl`, `SP.pnlCard`).

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
