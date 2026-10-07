# Backstop site

Strategy coin launchpad on Ethereum. Every trade pays a tax the creator sets at launch (1% to 10%):
0.8% to the platform, and the rest split the way the creator chose between themselves, holder rewards,
a vault that holds the backing token, a buyback fund that buys and burns on every 20% dip, and
auto-LP that adds locked liquidity to the pool. Options per coin: take-profit burns, redeem at
backing, and holder payouts in the backing token, ETH or up to four tokens.

    npm install
    npm run demo     # regenerate site/demo.json (sample coins simulated hour by hour from prices.json)
    npm run build    # bundle the wallet and build dist/ in preview mode
    npm run serve    # http://127.0.0.1:8795 with clean URLs (/launch, /coin/0x…)

Preview mode: sample coins, launching and trading closed. ETH price, gas and the backing-token check
on the launch form (Uniswap V2/V3 pools against ETH or USDC) read Ethereum mainnet live.

Pages: Explore (`/`), coin (`/coin/0x…`), Launch, Portfolio, How it works (`/docs`), Admin (`/admin`).
Charts use TradingView Advanced Charts, copied at build time from `../replica/charting_library` (or `$CHARTING_LIBRARY`).
`brand/` renders the icon, OG card, X banner and sample coin logos (`node render.cjs out`).
