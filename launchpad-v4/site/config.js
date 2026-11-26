/* Launchpad site configuration. Rename the brand here only.
   Two chains, every coin paired with native HYPE on Uniswap v4: HyperEVM (999) and Elysium (99901).
   Each coin lives on the chain it launched on; the site reads both through chain.js and /api/state?chain=<key>.
   CFG.chain is the active chain (the one the wallet is asked to use): a token page switches it to the token's
   chain, the launch form and the admin page let the user pick it. */
window.CFG = {
  brand: 'LiquidFi', tagline: 'Launch on HyperEVM and Elysium. HYPE pair on Uniswap v4, 1% fee, 70% to the creator.',
  x: 'https://x.com/liquidfi_fun', site: 'https://liquidfi.fun',
  mode: 'live',
  chains: [
    // HyperEVM: Uniswap's v4 deployment (PoolManager, PositionManager, UniversalRouter, Quoter) used as is
    { key: 'hyperevm', evm: true, id: 999, hex: '0x3e7', name: 'HyperEVM', short: 'HyperEVM', quote: 'HYPE', rpc: 'https://rpc.hyperliquid.xyz/evm', explorer: 'https://hyperevmscan.io', logo: '/img/hyper.png', color: '#97fce4', blockSec: 1, main: true,
      contracts: { factory: '0xC875D815044Ef2bBD4E286e2DbB54AF9a98Ba8A0', hook: '0xBAF9961BA462Abee6d4F86D9509C0BDd15f9A044', locker: '0x2e2804A111bCe151aA097a5376b44cBABfEc5D2b', escrow: '0x4f1e73B94B43B0EC7Da292dF9CC333bB863CF9b2', vault: '0x789Add57A12b92DEC1a2D1C9dc62360d42Be6051', poolManager: '0x12D4Fd9C5DeDd00ab8a0bCe2CF0167bbf94b6B1F', positionManager: '0x0d7Ab5B3db668128Aff6F70C4eBC71D7d4DA9bf9', multicall: '0xcA11bde05977b3631167028862bE2a173976CA11', router: '0x9aFe3C497e19501DB228F28CdBdD29bC98F65DBa', quoter: '0x108Bfe38532C98f8Cd8D7Ab49c9dDAa3675a1c5e' } },
    // Elysium (gas in HYPE, settles to HyperEVM): Uniswap's v4 PoolManager and UniversalRouter, our PositionManager build
    { key: 'elysium', evm: true, id: 99901, hex: '0x1863d', name: 'Elysium', short: 'Elysium', quote: 'HYPE', rpc: 'https://rpc-live.elysp.com', explorer: 'https://scan.elysp.com/#', logo: '/img/hyper.png', color: '#97fce4', blockSec: 1,
      contracts: { factory: '0x13757D66782ecA93A86A2A8B6cEEc74f10322b05', hook: '0xAA13d56014297e31d799D05406dA55F4c9256044', locker: '0x4DFB13BC1264f7bcA5Ed464E338C1A5ADC47C5d0', escrow: '0xb7C76c44e4fA523071cAD82E5865Bdf133097b38', vault: '0xfC15Ecc412ACDd25d9Ba33389E53579eD328DfbC', poolManager: '0xE2e105d3F7209A9DA11f83cCf3E7398a753823F1', positionManager: '0x73a3098520404f4eA174788Bab5f0E04810e6460', multicall: '0xcA11bde05977b3631167028862bE2a173976CA11', router: '0xA13f7611115752DEB2B13813BDDE16A5073e4b45', quoter: '0x379F556c5a748BD7Cc9baF0F7A344094Ac1814f5' } },
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
(function () {
  const C = window.CFG;
  C.live = (c) => !!(c && c.contracts.factory);
  C.liveChains = () => C.chains.filter(C.live);
  C.chainOf = (k) => C.chains.find((c) => c.key === k) || C.chains[0];
  let saved = ''; try { saved = localStorage.getItem('chain') || ''; } catch {}
  C.chain = C.chains.find((c) => c.key === saved && C.live(c)) || C.liveChains()[0] || C.chains[0];
  C.useChain = (k, remember = true) => { C.chain = C.chainOf(k); if (remember) try { localStorage.setItem('chain', C.chain.key); } catch {} return C.chain; };
})();
