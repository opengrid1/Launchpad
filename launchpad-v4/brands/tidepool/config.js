/* Tidepool site configuration: the launchpad on Elysium (gas in HYPE), every coin paired with native HYPE on Uniswap v4
   under the Tidepool hook. Contract addresses come from deployments/pad-elysium.json once deployed; until then the
   site shows its empty states. `stake` points at the fee flywheel: the splitter that turns protocol fees into rewards
   and the staking contract that pays them to $TIDE stakers. Built into a deployable copy by build/brand-site.cjs tidepool. */
window.CFG = {
  brand: 'Tidepool', tagline: 'Launch on Elysium. HYPE pair on Uniswap v4, 2.5% fee, 70% to the creator, and every protocol fee flows back to $TIDE stakers.',
  x: 'https://x.com/tidepool_fun', site: 'https://tidepool.fun',
  mode: 'live',
  chains: [
    // Elysium (gas in HYPE, settles to HyperEVM): Uniswap's v4 PoolManager and UniversalRouter, our PositionManager build
    { key: 'elysium', evm: true, id: 99901, hex: '0x1863d', name: 'Elysium', short: 'Elysium', quote: 'HYPE', quoteName: 'HYPE', native: 'HYPE', usd: 40, rpc: 'https://rpc-live.elysp.com', explorer: 'https://scan.elysp.com/#', logo: '/img/hyper.png', color: '#2fd4c2', blockSec: 1, main: true,
      contracts: { factory: '', hook: '', locker: '', escrow: '', vault: '', poolManager: '0xE2e105d3F7209A9DA11f83cCf3E7398a753823F1', positionManager: '', multicall: '0xcA11bde05977b3631167028862bE2a173976CA11', router: '0xA13f7611115752DEB2B13813BDDE16A5073e4b45', quoter: '0x379F556c5a748BD7Cc9baF0F7A344094Ac1814f5' } },
  ],
  admin: '0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b',
  official: [], // $TIDE: shown with an Official tag once launched
  /* the fee flywheel: protocol fees -> splitter -> stakers / buyback and burn of $TIDE / treasury */
  stake: { splitter: '', staking: '', token: '', symbol: 'TIDE', stakingBps: 3500, burnBps: 3500, durationDays: 7 },
  /* the launch economics, in HYPE (the *Hype names are the quote coin's amounts) */
  econ: {
    supply: 1e9, launchFeeHype: 0.005, maxDevBuyBps: 500,
    feeBps: 250, creatorShareBps: 7000, protocolShareBps: 3000, creatorTaxMaxBps: 1000,
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
