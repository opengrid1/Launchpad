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
  // the $TIDE airdrop: 20% of supply; points from trades and launches on Tidepool, a share for liquidity providers and
  // stakers (snapshot at the end). ends: ISO date; pools in percent of total supply
  airdrop: { ends: '2026-12-20T00:00:00Z', tradePts: 100, creatorPts: 10, minHype: 1, pools: [{ key: 'traders', pct: 15, title: 'Traders and creators', note: 'By volume, and by launching coins others trade.' }, { key: 'holders', pct: 5, title: '$TIDE holders', note: 'Hold $TIDE at the snapshot after the end date.' }] },
  stake: { splitter: '', staking: '', token: '', symbol: 'TIDE', stakingBps: 2000, burnBps: 3500, farmBps: 1500, durationDays: 7 },
  /* the AMM: our own pools for any two tokens (LP shares, 0.25% to LPs + 0.05% to the splitter per swap), and the farm
     that pays LP stakers the splitter's farm share in HYPE. Native HYPE is wrapped by the router. */
  amm: { factory: '', router: '', farm: '', wnative: '0xba876237b0f021a6c6d852d6c26e107997cc5e81', lpFeeBps: 25, protocolFeeBps: 5 },
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
