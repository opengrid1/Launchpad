/* BuzzPad site configuration: the LiquidFi site code on Ethereum mainnet, every coin paired with native ETH on
   Uniswap v4. Built into a deployable copy by build/brand-site.cjs buzzpad. Contracts: deployments/liquidfi-ethereum.json. */
window.CFG = {
  brand: 'BuzzPad', tagline: 'Launch on Ethereum. ETH pair on Uniswap v4, 1% fee, 70% to the creator.',
  x: 'https://x.com/buzzpad_fun', site: 'https://buzzpad.fun',
  mode: 'live',
  chains: [
    // Ethereum mainnet: Uniswap's v4 deployment (PoolManager, PositionManager, UniversalRouter, V4Quoter) used as is
    { key: 'ethereum', evm: true, id: 1, hex: '0x1', name: 'Ethereum', short: 'Ethereum', quote: 'ETH', quoteName: 'Ether', rpc: 'https://ethereum-rpc.publicnode.com', explorer: 'https://etherscan.io', logo: '/img/eth.svg', color: '#627eea', blockSec: 12, main: true,
      contracts: { factory: '0x341585f9E00bB9fAcf561957075C7e5b7d529134', hook: '0xdb96Eb48C3BC9E3ECaf3bA119D48A34aa15DA044', locker: '0x78508fFc10c9D776aa9816BE9974275513E2DA5e', escrow: '0x98B341bDF817658053a86c7e3Cb01E3D629902A5', vault: '0xDA5B1B6E70e0C67Ee73fec6E62916048602b32E4', poolManager: '0x000000000004444c5dc75cB358380D2e3dE08A90', positionManager: '0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e', multicall: '0xcA11bde05977b3631167028862bE2a173976CA11', router: '0x66a9893cc07d91d95644aedd05d03f95e1dba8af', quoter: '0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203' } },
  ],
  admin: '0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b',
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
  C.live = (c) => !!(c && c.contracts.factory);
  C.liveChains = () => C.chains.filter(C.live);
  C.chainOf = (k) => C.chains.find((c) => c.key === k) || C.chains[0];
  let saved = ''; try { saved = localStorage.getItem('chain') || ''; } catch {}
  C.chain = C.chains.find((c) => c.key === saved && C.live(c)) || C.liveChains()[0] || C.chains[0];
  C.useChain = (k, remember = true) => { C.chain = C.chainOf(k); if (remember) try { localStorage.setItem('chain', C.chain.key); } catch {} return C.chain; };
})();
