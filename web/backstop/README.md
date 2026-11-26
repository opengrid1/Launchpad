# Etherhook site

Strategy coin launchpad on Ethereum. Every trade pays a tax the creator sets at launch (1% to 10%):
1% to the platform, and the rest split the way the creator chose between themselves, holder rewards,
a vault that holds the backing token, a buyback fund that buys and burns on every 20% dip, and
auto-LP that adds locked liquidity to the pool. Options per coin: take-profit burns, redeem at
backing, and holder payouts in the backing token, ETH or up to four tokens.

    npm install
    npm run build    # bundle the wallet + chain layer and build dist/
    npm run serve    # http://127.0.0.1:8795 with clean URLs (/launch, /coin/0x…)

Live data only. src/chain.js (bundled into js/wallet.js as window.EH) reads the deployed contracts
(addresses from contracts/deployments/eth-backstop.json), Uniswap V4 state through StateView, and
history (trades, burns, fee splits) from Blockscout's log API with the newest blocks from the RPC.
With no coins launched the pages show empty states. backing.json (gen_backing.cjs) lists the Ondo
stocks the oracle prices; the admin page lists them on the oracle.
Fork testing: RPCS=http://localhost:8546 BLOCKSCOUT= python3 build.py

Pages: Explore (`/`), coin (`/coin/0x…`), Launch, Portfolio, How it works (`/docs`), Admin (`/admin`).
Charts use TradingView Advanced Charts, copied at build time from `../replica/charting_library` (or `$CHARTING_LIBRARY`).
`brand/` renders the icon, pfp, OG card and X banner (`node render.cjs out`); `brand/default-token.py` makes the default token image.
