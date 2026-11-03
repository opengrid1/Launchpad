/* Launchpad site configuration. Rename the brand here only.
   One chain: Elysium (99901), every coin paired with native HYPE.
   mode: 'demo' runs the whole site on generated data (demo.js) until the contracts are deployed;
   'live' reads the contracts in `chains[].contracts` through chain.js (not written yet, see SPEC.md). */
window.CFG = {
  brand: 'LiquidFi', tagline: 'Launch on Elysium. HYPE pair, locked liquidity, 1% fee, 70% to the creator.',
  x: 'https://x.com/', site: '',
  mode: 'demo',
  chains: [
    // Elysium (chain 99901, gas in HYPE). The key stays 'hyper' because the pages use it as the HYPE-chain key.
    // positionManager is ours (Uniswap's official build), filled in by deploy-liquidfi.cjs's output.
    { key: 'hyper', evm: true, id: 99901, hex: '0x1863d', name: 'Elysium', short: 'Elysium', quote: 'HYPE', rpc: 'https://rpc-live.elysp.com', explorer: 'https://scan.elysp.com/#', logo: '/img/hyper.png', color: '#97fce4', blockSec: 1, main: true,
      contracts: { factory: '0x13757D66782ecA93A86A2A8B6cEEc74f10322b05', hook: '0xAA13d56014297e31d799D05406dA55F4c9256044', locker: '0x4DFB13BC1264f7bcA5Ed464E338C1A5ADC47C5d0', escrow: '0xb7C76c44e4fA523071cAD82E5865Bdf133097b38', vault: '0xfC15Ecc412ACDd25d9Ba33389E53579eD328DfbC', poolManager: '0xE2e105d3F7209A9DA11f83cCf3E7398a753823F1', positionManager: '0x73a3098520404f4eA174788Bab5f0E04810e6460', multicall: '0xcA11bde05977b3631167028862bE2a173976CA11' } },
  ],
  admin: '0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b',
  /* the launch economics from SPEC.md, the same on both chains, shown on the forms and the token page */
  econ: {
    supply: 1e9, launchFeeHype: 0.005, maxDevBuyBps: 500,
    feeBps: 100, creatorShareBps: 7000, protocolShareBps: 3000, creatorTaxMaxBps: 1000,
    buybackShareBps: 5000, buybackVestYears: 5,
    snipeSeconds: 10, snipeStartBps: 9900, snipeHalvings: 14,
    volThresholdBps: 1000, volPeakBps: 300, volWindowSec: 60, volDecaySec: 120,
    openMcapHype: 50, bands: [[50, 200, 20], [200, 1000, 30], [1000, Infinity, 50]], // [from mcap, to mcap, % of supply]
    vanityZeros: 4, bridgeMinutes: 1,
  },
  limits: { name: 32, ticker: 10, desc: 256, imageMb: 5 },
};
window.CFG.chain = window.CFG.chains[0];
window.CFG.chainOf = (k) => window.CFG.chains.find((c) => c.key === k) || window.CFG.chains[0];
