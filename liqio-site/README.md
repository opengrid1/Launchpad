# Liqio site

The front end of Liqio, the HyperEVM launchpad: coins paired with HYPE, USDC or a wrapped xStock, each in its own
Uniswap v4 pool on Hyperliquid's EVM. Static HTML and vanilla JS, grown from the Equo site (`../stockpad-site`),
so the two share their shell, pages and conventions (see `DESIGN.md`).

## What is different from Equo

- `config.js`: one chain (HyperEVM, 999), WHYPE as the native pair, `cryptoPairs` (USDC) and `stocks` (wrapped
  xStocks by Backed, with the Hyperliquid market behind each one and its PRJX route), the HyperEVM quoters, and
  `preview: true` while the contracts are not deployed.
- `hl.js`: pair prices from Hyperliquid's public info API (the mids HyperCore's oracle follows), scaled by each
  wrapped xStock's ERC-4626 share ratio read from the token. Fills the price map before the contracts exist and
  stays as the fallback after.
- `chain.js` and `wallet.js` are the Equo bundles with the native coin relabelled HYPE and the wallet network set
  to HyperEVM (chain 999, official RPC, HyperEVMScan). They are patched copies, not rebuilt.
- No bridge page, no chain selector: the shared code hides every multichain control when `chains` has one entry.
- `preview.js`: three example coins (Hyperion, Green Chips, Index Fund Coin) and a stand-in for the chain layer's
  ready promise while no factory is configured. `/?preview=0` hides the examples in a browser.
- `docs/`: the Equo docs rewritten for Liqio (HyperCore oracle, clone coins, xStocks, PRJX/KittenSwap routes).

## Running it

Any static server with clean URLs works for the pages (`/markets` → `markets.html`, `/token/<addr>` → `token.html`).
`charting_library/` is the TradingView library (licensed, not in the repo; here it is a symlink to the Equo copy).

Deploy: a Vercel project (`vercel.json` has the rewrites); copy `charting_library/` into the upload.

## Going live

When the contracts are deployed on HyperEVM, fill `contracts` in `config.js` (factory, hook, router, tokenDeployer,
oracle), set `deployBlock`, set the chain's `deployed: true`, turn `preview` off, and point `api` at the indexer
once it indexes HyperEVM.
