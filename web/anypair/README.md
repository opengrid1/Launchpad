# Anypair site

Launchpad on Base where a coin pairs with any token and holders earn in tokens the creator picks.
Static pages wrapped in one shell by `build.py`; `src/chain.js` (reads + transactions, ethers v6) and
`src/wallet.js` (Reown AppKit, or the browser wallet) are bundled into `site/js/`.

    npm install
    npm run build:fork      # against a local Base fork on 127.0.0.1:8545 (deployment: ../anypair-fork.json)
    DEPLOY=../../contracts/deployments/base-anypair.json npm run build:live
    npm run serve           # http://127.0.0.1:8790 with clean URLs (/launch, /coin/0x…)

Pages: Explore (`/`, filter by pair), coin (`/coin/0x…`), Launch, Portfolio, How it works (`/docs`),
and Admin (`/admin`, only does anything for the admin wallet).

`e2e.js` drives a full launch / buy / sell / claim / admin run on the fork with an injected test wallet.
