/* Lootbag deployment config, read by the site, the admin page and the wallet connection. Addresses are the Base mainnet deployment recorded in deployments/lootbag-base.json. */
window.LB_CFG = {
  chainId: 8453,
  chainName: 'Base',
  // Public RPCs, tried in this order. They rate-limit and drop out, so there is more than one.
  rpc: 'https://base-rpc.publicnode.com',
  rpcFallbacks: ['https://mainnet.base.org', 'https://base.drpc.org'],
  explorer: 'https://basescan.org',
  // the log cache (api/logs.js): closed windows of history, kept by the CDN. Empty reads everything from the RPC.
  logsApi: '/api/logs',
  // the wallet that owns the contracts and runs the rounds by hand
  owner: '0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b',
  // Reown (WalletConnect) project id: public, it only identifies the site to Reown. The site's domain must be on
  // the project's allowlist in the Reown dashboard, or mobile wallets will refuse the connection.
  walletConnect: { projectId: 'e1bda672d5deb56579fe084dddfb9174' },
  startBlock: 62532742,
  contracts: {
    factory: '0x7dfcc0a34E1bfBb8228b582Dc355fe8f7B1f64a6',
    hook: '0x3F7917B7B8bf79a7e84641491d9de80dea6ceAcC',
    payout: '0x80eB12D43791E64cAeD65268A9e9aE590A761029',
    swapper: '0x8c4D29F5d7A0DfC8B6D2d68649E0e3b1F116B34B',
    bags: '0xed0aC0Cf3bB84fC431F214A6b96db6611B36FaA7',
    airdrop: '0x3b12bEDe3839da8E9668eaF865B119d3C39227D7',
    router: '0xFf6575873d47829a68c9d3D4e28bcFD937393DDe',
    poolManager: '0x498581fF718922c3f8e6A244956aF099B2652b2b',
  },
  multicall: '0xcA11bde05977b3631167028862bE2a173976CA11',
  // where the USD prices of ETH and VVV are read: their pools against USDC
  pools: { ethUsdc: '0xb2cc224c1c9feE385f8ad6a55b4d94E92359DC59', vvvUsdc: '0x67A11022B7B6ed66f81233F6C8Ed6e48F7826530' },
  // true only when the factory in use cannot withdraw a pool's liquidity. This one can (collect), so it is false.
  liquidityLocked: false,
  // $LOOT's address, once it is launched (the Bags contract also reports it)
  loot: '',
  tokens: {
    VVV: ['0xacfE6019Ed1A7Dc6f7B508C02d1b04ec88cC21bf', 18],
    WETH: ['0x4200000000000000000000000000000000000006', 18],
    USDC: ['0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 6],
  },
};
// Testing against a local fork: on localhost only, localStorage 'lb-test' (JSON) overrides fields of this config.
try {
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) { const t = JSON.parse(localStorage.getItem('lb-test') || 'null'); if (t) Object.assign(window.LB_CFG, t); }
} catch (e) { /* no storage */ }
// The draft view shows the text written for the next contracts, under a strip that says so. It changes words only,
// and only in the browser that asked for it: /draft or ?draft=1 turns it on there and it is remembered; ?draft=0
// turns it off.
try {
  if (typeof location !== 'undefined') {
    if (/[?&]draft=1\b/.test(location.search)) localStorage.setItem('lb-draft', '1');
    if (/[?&]draft=0\b/.test(location.search)) localStorage.removeItem('lb-draft');
    if (localStorage.getItem('lb-draft') === '1') window.LB_CFG.draft = true;
  }
} catch (e) { /* not a browser, or no storage */ }
