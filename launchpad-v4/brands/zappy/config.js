/* Zappy site configuration: the launchpad site code on Base, every coin paired with native ETH on Uniswap v4 through
   the v2 contracts (deployments/zappy-v2-base.json): fees paid out in ETH straight to the creator and the protocol.
   Built into a deployable copy by build/brand-site.cjs zappy. */
window.CFG = {
  brand: 'Zappy', tagline: 'Launch a coin on Base. ETH pair on Uniswap v4, 1% fee, 70% to the creator.',
  x: 'https://x.com/zappy_fun', site: 'https://zappy.fun',
  mode: 'live',
  chains: [
    // Base: Uniswap's v4 deployment (PoolManager, PositionManager, UniversalRouter, V4Quoter) used as is; no v1 contracts
    { key: 'base', evm: true, id: 8453, hex: '0x2105', name: 'Base', short: 'Base', quote: 'ETH', quoteName: 'Ether', usd: 2400, rpc: 'https://mainnet.base.org', explorer: 'https://basescan.org', logo: '/img/eth.svg', color: '#1d4ff2', blockSec: 2, main: true,
      contracts: { factory: '', hook: '', locker: '', escrow: '', vault: '', poolManager: '0x498581fF718922c3f8e6A244956aF099B2652b2b', positionManager: '0x7C5f5A4bBd8fD63184577525326123B519429bDc', multicall: '0xcA11bde05977b3631167028862bE2a173976CA11', router: '0x6fF5693b99212Da76ad316178A184AB56D299b43', quoter: '0x0d5e0F971ED27FBfF6c2837bf31316121532048D' },
      v2: { factory: '0xAe6e1C7f5F34BaabCB7f545bc6ADcdA65418cB66', hook: '0x3fc4B416e02c2879FfBDa58b5D77095965B4A0CC', locker: '0x1cdBd96F80F7e9ac45bBf4fDFaC7D4F5Fdf003CA',
        pairs: [ { key: 'eth', sym: 'ETH', name: 'Ether', addr: '0x0000000000000000000000000000000000000000', cfg: 0, open: 1.75, logo: '/img/eth.svg' } ] } },
  ],
  admin: '0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b',
  official: ['0xa9dc0d6d667ddc546aa1aab6561aba6c543be486'], // ZAPPY: shown with an Official tag
  /* the launch economics, in ETH (the *Hype names are the quote coin's amounts, kept from the shared code) */
  econ: {
    supply: 1e9, launchFeeHype: 0.0002, maxDevBuyBps: 500,
    feeBps: 100, creatorShareBps: 7000, protocolShareBps: 3000, creatorTaxMaxBps: 1000,
    buybackShareBps: 5000, buybackVestYears: 5,
    snipeSeconds: 10, snipeStartBps: 9900, snipeHalvings: 14,
    volThresholdBps: 1000, volPeakBps: 300, volWindowSec: 60, volDecaySec: 120,
    openMcapHype: 1.75, bands: [[1.75, 7, 20], [7, 35, 30], [35, Infinity, 50]], // [from mcap, to mcap, % of supply]
    vanityZeros: 4, bridgeMinutes: 1,
  },
  limits: { name: 32, ticker: 10, desc: 256, imageMb: 5 },
};
(function () {
  const C = window.CFG;
  C.live = (c) => !!(c && (c.contracts.factory || (c.v2 && c.v2.factory)));
  C.liveChains = () => C.chains.filter(C.live);
  C.chainOf = (k) => C.chains.find((c) => c.key === k) || C.chains[0];
  let saved = ''; try { saved = localStorage.getItem('chain') || ''; } catch {}
  C.chain = C.chains.find((c) => c.key === saved && C.live(c)) || C.liveChains()[0] || C.chains[0];
  C.useChain = (k, remember = true) => { C.chain = C.chainOf(k); if (remember) try { localStorage.setItem('chain', C.chain.key); } catch {} return C.chain; };
})();
