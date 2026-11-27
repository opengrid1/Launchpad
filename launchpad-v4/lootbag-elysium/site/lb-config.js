/* KinetiqPump on Elysium: deployment config, read by the site, the admin page, the log cache and the wallet connection.
   The contract addresses come from deployments/kinetiqpump-elysium.json, written by deploy.cjs. With them empty the
   site says that KinetiqPump is not live on Elysium yet and sends nothing. */
window.LB_CFG = {
  // The name. It is an independent project named after the Kinetiq ecosystem it runs in, and is not Kinetiq's own:
  // the site says so in its footer. `coin` is the ticker of the platform's own coin (the address goes in `loot` below once it has
  // launched), `nft` and `nfts` are what the vault NFTs are called, `x` is the X handle (empty: no link is shown).
  brand: { name: 'KinetiqPump', coin: 'KPUMP', nft: 'Jar', nfts: 'Jars', x: 'kinetiqpump_fun' },
  chainId: 99901,
  chainName: 'Elysium',
  // the chain's own coin, which every trade is paid in and received in
  native: { name: 'HYPE', symbol: 'HYPE', decimals: 18 },
  // Public RPCs, tried in this order. They rate-limit and drop out, so there is more than one.
  rpc: 'https://rpc.elysium.kinetiq.xyz',
  rpcFallbacks: ['https://rpc-live.elysp.com', 'https://rpc.stockium.fun', 'https://rpc.volta.family'],
  explorer: 'https://scan.elysp.com/#',
  explorerName: 'Elysium explorer',
  // Elysium makes about five blocks a second and its RPC answers logs over millions of blocks at once, so history is
  // read in windows of 450,000 blocks (about a day); the log cache keeps windows of that size and ten times it.
  logSpan: 450000,
  blockTime: 0.2,
  // the log cache (api/logs.js): closed windows of history, kept by the CDN. Empty reads everything from the RPC.
  logsApi: '/api/logs',
  // the wallet that owns the contracts and runs the rounds by hand
  owner: '0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b',
  // Reown (WalletConnect) project id: public, it only identifies the site to Reown. The site's domain must be on
  // the project's allowlist in the Reown dashboard, or mobile wallets will refuse the connection.
  walletConnect: { projectId: 'e1bda672d5deb56579fe084dddfb9174' },
  // the block the contracts were deployed at: history is read from here
  startBlock: 11729933,
  // from deployments/kinetiqpump-elysium.json
  contracts: {
    factory: '0x97723998d192487F4615619E34253Ad754050bFB',
    hook: '0x1bCD52feAFda10C6411768600C5F143E997BeacC',
    payout: '0x24556E0DAF51e680FD43fF28D55569ff10E37E92',
    swapper: '0x270d6775F9b6ed018C65C2E4c8C912d43d2d8972',
    bags: '0xE742c1732ac1770aca0dC9D7e5fdF9DDaf6d9743',
    airdrop: '0x35cC2A6B4fE19c10F8Ccd2B63c19F88d3B46b210',
    router: '0x0896Cb3b92C1E5Cbb6bbE263f16f346d4a993067',
    poolManager: '0xE2e105d3F7209A9DA11f83cCf3E7398a753823F1',
  },
  multicall: '0xcA11bde05977b3631167028862bE2a173976CA11',
  // HYPE's dollar price is Hyperliquid's mid price. KNTQ's is read from Elysium's WHYPE/KNTQ Uniswap v4 pool (the
  // pool the routes use) and turned into dollars with HYPE's; Hyperliquid's KNTQ spot market stands in if that fails.
  prices: { api: 'https://api.hyperliquid.xyz/info', hype: 'HYPE', kntq: '@334', kntqPoolId: '0xa3f234a829d1c4a980e9776ccddf4b0c12070e03a0558d1eed2e9c0090d3cd7a' },
  // true only when the factory in use cannot withdraw a pool's liquidity. This one can (collect), so it is false.
  liquidityLocked: false,
  // KinetiqPump's own coin on Elysium, $KPUMP (kinetiqpump.fun), paired with KNTQ: shown as official
  loot: '0x56bc3848551F532DacD85751Acaf66Dc1b93766a',
  // coins left off the board, the coin lists and search; their own page still opens from a direct link
  hidden: [],
  // what a coin can be paired with or pay, besides KinetiqPump coins: [address, decimals, name]. HYPE is WHYPE on-chain:
  // buyers pay and receive HYPE itself, and holders paid in it receive HYPE itself.
  tokens: {
    HYPE: ['0xbA876237B0F021A6c6D852d6c26E107997cC5E81', 18, 'Hyperliquid'],
    KNTQ: ['0xe45a355d9e9cAd2aD85F2d03E3eE3102A036acF0', 18, 'Kinetiq'],
  },
};
// Testing against a local fork: on localhost only, localStorage 'lb-test' (JSON) overrides fields of this config.
try {
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) { const t = JSON.parse(localStorage.getItem('lb-test') || 'null'); if (t) Object.assign(window.LB_CFG, t); }
} catch (e) { /* not a browser, or no storage */ }
