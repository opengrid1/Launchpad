# cntrl-z.fun

A launchpad on Ethereum where every buy can be cancelled inside a window the buyer rents (30 minutes to 7 days,
0.05 ETH per six hours, at most 30% of the buy). Coins pair with ETH, tokenized gold or any Ondo tokenized stock.
1% tax on every trade: 0.7% to the creator, 0.3% to the platform. Premiums buy the coin and burn it.

    npm install
    npm run bundle          # wallet + chain layer -> site/js/wallet.js
    python3 build.py        # -> dist/, live against contracts/deployments/eth-cntrlz.json (PREVIEW=1 for sample coins)
    python3 serve.py 8798

Local fork: `FORK=1 npx hardhat node --config hardhat.config.cntrlz.ts` in contracts/, seed it with
`scripts/seed-cntrlz-fork.ts`, then `RPCS=http://127.0.0.1:8545 BLOCKSCOUT= INJECTED_ONLY=1 python3 build.py`.

`brand/brand.html` + `brand/render.cjs` render the mark, icons, pfp, banner and OG card into site/img.
