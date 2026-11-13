/* Hypex site configuration (design preview: no contracts yet, sample coins from /demo-state.json): the launchpad on Elysium (gas in HYPE), every coin paired with native HYPE on Uniswap v4
   under the Kinex hook. Contract addresses come from deployments/pad-elysium.json once deployed; until then the
   site shows its empty states. `stake` points at the fee flywheel: the splitter that turns protocol fees into rewards
   and the staking contract that pays them to $KINEX stakers. Built into a deployable copy by build/brand-site.cjs tidepool. */
window.CFG = {
  demo: true, // no contracts yet: the sample coins from /demo-state.json
  brand: 'Hypex', tagline: 'The launchpad on Elysium where every trade lifts the floor, and pays the trader back in HYPE.',
  x: 'https://x.com/hypex_fun', site: '',
  walletConnect: { projectId: 'e1bda672d5deb56579fe084dddfb9174' }, // Reown (WalletConnect) project; public by design, it ships to every browser
  mode: 'live',
  chains: [
    // Elysium (gas in HYPE, settles to HyperEVM): Uniswap's v4 PoolManager and UniversalRouter, our PositionManager build
    { key: 'elysium', evm: true, id: 99901, hex: '0x1863d', name: 'Elysium', short: 'Elysium', quote: 'HYPE', quoteName: 'HYPE', native: 'HYPE', usd: 40, rpc: 'https://rpc.elysium.kinetiq.xyz', rpcs: ['https://rpc.elysium.kinetiq.xyz', 'https://rpc-live.elysp.com', 'https://rpc.stockium.fun', 'https://rpc.volta.family'], explorer: 'https://scan.elysp.com/#', logo: '/img/hyper.png', color: '#2fd4c2', blockSec: 1, main: true, hopLayout: true,
      // what a coin can pair with: HYPE, or an EQX tokenized stock (launch config id per pair, Hyperliquid spot id for its price)
      pairs: [{"key":"hype","sym":"HYPE","name":"HYPE","addr":"0x0000000000000000000000000000000000000000","cfg":0,"decimals":18,"logo":"/img/hyper.png","kind":"crypto"}],
      // Hypex floor stack (hypex-eth/deployments/elysium.json once deployed; until then the preview's sample coins)
      whChain: 74,
      contracts: { factory: '', hook: '', revenue: '', bridge: '', poolManager: '0xE2e105d3F7209A9DA11f83cCf3E7398a753823F1', router: '0xA13f7611115752DEB2B13813BDDE16A5073e4b45', quoter: '0x379F556c5a748BD7Cc9baF0F7A344094Ac1814f5', multicall: '0xcA11bde05977b3631167028862bE2a173976CA11' } },
    // HyperEVM: every Hypex coin has its own pool and floor here too, at the same address (HypexBridge moves coins
    // and their floor HYPE between the two over Wormhole)
    { key: 'hyperevm', evm: true, id: 999, hex: '0x3e7', name: 'HyperEVM', short: 'HyperEVM', quote: 'HYPE', quoteName: 'HYPE', native: 'HYPE', rpc: 'https://rpc.hyperliquid.xyz/evm', rpcs: ['https://rpc.hyperliquid.xyz/evm', 'https://hyperliquid.drpc.org'], explorer: 'https://hyperevmscan.io', logo: '/img/hyper.png', color: '#4f9a2a', blockSec: 1, whChain: 47,
      pairs: [{"key":"hype","sym":"HYPE","name":"HYPE","addr":"0x0000000000000000000000000000000000000000","cfg":0,"decimals":18,"logo":"/img/hyper.png","kind":"crypto"}],
      contracts: { factory: '', hook: '', revenue: '', bridge: '', poolManager: '0x12D4Fd9C5DeDd00ab8a0bCe2CF0167bbf94b6B1F', router: '0x9aFe3C497e19501DB228F28CdBdD29bC98F65DBa', quoter: '0x108Bfe38532C98f8Cd8D7Ab49c9dDAa3675a1c5e', multicall: '0xcA11bde05977b3631167028862bE2a173976CA11' } },
  ],
  admin: '0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b',
  official: [], // $HYPEX once launched
  /* the fee flywheel: protocol fees -> splitter -> stakers / buyback and burn of $KINEX / treasury */
  // the $KINEX airdrop: 20% of the supply in three pools. Points: 1 HYPE traded on Kinex = tradePts (from minHype on),
  // a creator earns creatorPts per HYPE other wallets trade on their coin; trades on other Elysium launchpads earn
  // otherBeforePts per HYPE before Kinex opened and otherAfterPts after, half of that pool by points and half equally
  // among wallets that swapped 1 HYPE before Kinex; the holders pool is claimed after the campaign. ends/review: ISO.
  airdrop: {
    ends: '2026-12-20T00:00:00Z', review: '2026-12-23T00:00:00Z', launchAt: '2026-11-15T00:00:00Z',
    tradePts: 100, creatorPts: 10, minHype: 1, otherBeforePts: 200, otherAfterPts: 100,
    pools: [{ key: 'traders', pct: 10, title: 'Kinex traders and creators', note: 'Earned by volume, and by launching coins others trade.' },
      { key: 'other', pct: 5, title: 'Traders on other platforms', note: 'Swap 1 HYPE elsewhere on Elysium. Volume before Kinex counts double.' },
      { key: 'holders', pct: 5, title: 'HYPE and KNTQ holders', note: 'For holders of both assets. Claim after the campaign.' }],
    venues: ['Volta', 'BOXA', 'Kleos', 'ElysPump', 'Montra', 'Ascend', 'Stockium', 'Agora', 'Elysa'],
    holderAssets: ['HYPE', 'KNTQ'],
  },
  /* the bridge: Elysium is a rollup on HyperEVM. Deposits go through the rollup's Inbox on HyperEVM (depositEth, same
     address on both sides); withdrawals start on Elysium (ArbSys.withdrawEth) and are claimed on HyperEVM through the
     Outbox once the rollup has confirmed them (about 6 to 7 days). */
  bridge: {
    parent: { key: 'hyperevm', id: 999, hex: '0x3e7', name: 'HyperEVM', rpc: 'https://rpc.hyperliquid.xyz/evm', explorer: 'https://hyperevmscan.io', native: 'HYPE' },
    inbox: '0xce59f8B65ad41C9DAE4c07A0571a39824bD92cff', outbox: '0xeC6B106DfA14428FE5Eec2a4065a7be599f02728', rollup: '0x508C173dFe5F737B3493195Bf785d71fA76fD217',
    arbSys: '0x0000000000000000000000000000000000000064', nodeInterface: '0x00000000000000000000000000000000000000C8',
    claimDays: '6 to 7', anyChain: { coins: ['BTC', 'ETH', 'SOL', 'USDT', 'USDC', 'BNB'], note: 'Send from any wallet or exchange; it arrives as HYPE on HyperEVM, one click away from Elysium.' },
  },
  stake: { splitter: '', staking: '', token: '', symbol: 'HYPEX', stakingBps: 0, burnBps: 0, farmBps: 0, durationDays: 7 },
  /* the AMM: our own pools for any two tokens (LP shares, 0.25% to LPs + 0.05% to the splitter per swap), and the farm
     that pays LP stakers the splitter's farm share in HYPE. Native HYPE is wrapped by the router. */
  amm: null,
  /* the launch economics, in HYPE (the *Hype names are the quote coin's amounts) */
  econ: {
    supply: 1e9, launchFeeHype: 0.005, maxDevBuyBps: 500,
    feeBps: 250, split: { floor: 50, traders: 70, creator: 70, platform: 60 }, creatorShareBps: 2800, protocolShareBps: 7200, creatorTaxMaxBps: 0,
    buybackShareBps: 5000, buybackVestYears: 5,
    snipeSeconds: 10, snipeStartBps: 9900, snipeHalvings: 14,
    volThresholdBps: 0, volPeakBps: 250, volWindowSec: 60, volDecaySec: 120, // the fee never moves on a pump or a dump
    openMcapHype: 50, bands: [[50, Infinity, 100]], // one single-sided range: the whole supply from the opening market cap to the top
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
