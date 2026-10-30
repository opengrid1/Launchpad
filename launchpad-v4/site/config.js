/* Launchpad site configuration. Rename the brand here only.
   One coin launches on both chains at once (Pangea style): a HyperEVM pool paired with HYPE and a Solana pool paired
   with HYPE on Solana (the bridged HYPE mint), same opening price, same supply per chain, bridged with LayerZero.
   mode: 'demo' runs the whole site on generated data (demo.js) until the contracts are deployed;
   'live' reads the contracts in `chains[].contracts` through chain.js (not written yet, see SPEC.md). */
window.CFG = {
  brand: 'GODMODE', tagline: 'Launch on HyperEVM and Solana at once. HYPE pair on both, locked liquidity, 1% fee, 70% to the creator.',
  x: 'https://x.com/', site: '',
  mode: 'demo',
  chains: [
    { key: 'hyper', evm: true, id: 999, hex: '0x3e7', name: 'HyperEVM', short: 'HyperEVM', quote: 'HYPE', rpc: 'https://rpc.hyperliquid.xyz/evm', explorer: 'https://hyperevmscan.io', logo: '/img/hyper.png', color: '#97fce4', blockSec: 1, main: true,
      contracts: { factory: '', hook: '', locker: '', escrow: '', vault: '', poolManager: '0x12D4Fd9C5DeDd00ab8a0bCe2CF0167bbf94b6B1F', positionManager: '0x0d7Ab5B3db668128Aff6F70C4eBC71D7d4DA9bf9' } },
    { key: 'sol', evm: false, name: 'Solana', short: 'Solana', quote: 'HYPE', explorer: 'https://solscan.io', logo: '/img/sol.png', color: '#b39dff', blockSec: 0.4, main: false,
      /* HYPE on Solana: the bridged HYPE mint (verified on Jupiter, 9 decimals) */
      quoteMint: '98sMhvDwXj1RQi5c5Mndm3vPe9cBqPrbLaufMXFNMh5g', contracts: { program: '', oft: '' } },
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
