# Wallet layer

Reown AppKit with the ethers adapter, bundled into `../wallet.js`:

```
npm install
npx esbuild wallet.js --bundle --minify --format=iife --target=es2020 --platform=browser --define:process.env.NODE_ENV='"production"' --outfile=../wallet.js
```

The project id lives in `../config.js` (`window.INKY.reownProjectId`); an empty id keeps the demo wallet.

# Chain layer

`chain.js` reads Ink straight from the browser (ethers v6 over the public RPC, Trade events through the Blockscout logs API) and sends transactions through the connected wallet. It exposes `window.CHAIN` (tokens, trades, quotes, buy/sell, launch, claims, leaderboard, profile, candles, operator calls) and uses the minimal ABIs in `abi.json`. Bundle it the same way:

```
npx esbuild chain.js --bundle --minify --format=iife --target=es2020 --platform=browser --define:process.env.NODE_ENV='"production"' --outfile=../chain.js
```

Contract addresses, the deploy block and the approved stock pairs come from `../config.js` (`window.INKY`). Pages wait for `CHAIN.ready` before they render; `vercel.json` gives the site clean URLs (`/launch`, `/profile`, `/leaderboard`, `/docs/<page>`, `/token/<address>`, and the unlisted `/admin`). `serve.py` mimics those routes locally.
