# cntrl-z.fun

A launchpad on Ethereum where every buy can be undone inside a window the creator sets. Coins pair with ETH,
stablecoins, bitcoin, gold or any Ondo tokenized stock. 1% tax (0.5% creator, 0.3% platform, 0.2% undo reserve);
undo fees go half to the reserve and half to holders or burn.

Preview site (the contracts are not deployed yet; coins are examples):

    npm install
    npm run bundle          # wallet bundle -> site/js/wallet.js
    python3 build.py        # -> dist/ (CHARTING_LIBRARY=... to point at the TradingView library)
    python3 serve.py 8798

`brand/brand.html` + `brand/render.cjs` render the mark, icons, pfp, banner and OG card into site/img.
