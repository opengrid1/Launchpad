/* KinetiqPump site configuration: the same launchpad as Kinex (the Pad contracts and the Tidepool front-end), deployed a
   second time on Elysium under its own name. Every coin trades on Uniswap v4 under the KinetiqPump hook (PadHookFixed: its pool fee is fixed at deployment), paired with
   native HYPE or a listed pair. Contract addresses come from deployments/pad-kinetiqpump-2.json. `stake` points at the
   fee flywheel: the splitter that spends the protocol's share on buying $KPUMP back and burning it. Built into a
   deployable copy by build/tide-site.cjs <outDir> kinetiqpump. */
window.CFG = {
  demo: false, // live on Elysium; true shows the sample coins from /demo-state.json instead
  brand: 'KinetiqPump', tagline: 'Launch on Elysium. HYPE pair on Uniswap v4, a fixed 3% fee, 1.2% of every trade to the creator, and the protocol share buys $KPUMP back.',
  x: 'https://x.com/kinetiqpump_fun', site: 'https://kinetiqpump.fun',
  walletConnect: { projectId: 'e1bda672d5deb56579fe084dddfb9174' }, // Reown (WalletConnect) project; public by design, it ships to every browser
  mode: 'live',
  chains: [
    // Elysium (gas in HYPE, settles to HyperEVM): Uniswap's v4 PoolManager and UniversalRouter, our PositionManager build
    { key: 'elysium', evm: true, id: 99901, hex: '0x1863d', name: 'Elysium', short: 'Elysium', quote: 'HYPE', quoteName: 'HYPE', native: 'HYPE', usd: 40, rpc: 'https://rpc.elysium.kinetiq.xyz', rpcs: ['https://rpc.elysium.kinetiq.xyz', 'https://rpc-live.elysp.com', 'https://rpc.stockium.fun', 'https://rpc.volta.family'], explorer: 'https://scan.elysp.com/#', logo: '/img/hyper.png', color: '#f06a08', blockSec: 1, main: true, hopLayout: true,
      // what a coin can pair with: HYPE, or an EQX tokenized stock (launch config id per pair, Hyperliquid spot id for its price)
      pairs: [{"key":"hype","sym":"HYPE","name":"HYPE","addr":"0x0000000000000000000000000000000000000000","cfg":0,"decimals":18,"logo":"/img/hyper.png","kind":"crypto"},{"key":"eqnvda","sym":"EQNVDA","name":"NVIDIA","ticker":"NVDA","addr":"0x5ceff5c7316067b81b537a9ae011d6882f0a558a","cfg":1,"decimals":8,"spot":"@1155","logo":"/img/stocks/eqnvda.svg","kind":"stock"},{"key":"eqtsla","sym":"EQTSLA","name":"Tesla","ticker":"TSLA","addr":"0x7559191f12413d122493fe43de6d0b4544c6579f","cfg":2,"decimals":8,"spot":"@1156","logo":"/img/stocks/eqtsla.svg","kind":"stock"},{"key":"eqaapl","sym":"EQAAPL","name":"Apple","ticker":"AAPL","addr":"0x60f8bf68d4b85cb9079fe68742edad328d35f004","cfg":3,"decimals":8,"spot":"@1157","logo":"/img/stocks/eqaapl.svg","kind":"stock"},{"key":"eqmsft","sym":"EQMSFT","name":"Microsoft","ticker":"MSFT","addr":"0x05a297057bc92cea0259d87901a65284e2e32026","cfg":4,"decimals":8,"spot":"@1160","logo":"/img/stocks/eqmsft.svg","kind":"stock"},{"key":"eqgoog","sym":"EQGOOG","name":"Alphabet","ticker":"GOOGL","addr":"0x3adb8e7a4eda0a1581b59aa168aa5dbcb2880f51","cfg":5,"decimals":8,"spot":"@1158","logo":"/img/stocks/eqgoog.svg","kind":"stock"},{"key":"eqmeta","sym":"EQMETA","name":"Meta","ticker":"META","addr":"0x6a62e27ea23a933990e3b444cc23809314e9991b","cfg":6,"decimals":8,"spot":"@1159","logo":"/img/stocks/eqmeta.svg","kind":"stock"},{"key":"eqamzn","sym":"EQAMZN","name":"Amazon","ticker":"AMZN","addr":"0xa98485140bc6d87c74b5fd59d11f086221cef0bc","cfg":7,"decimals":8,"spot":"@1161","logo":"/img/stocks/eqamzn.svg","kind":"stock"},{"key":"eqmu","sym":"EQMU","name":"Micron","ticker":"MU","addr":"0x85854e22a602fff395240d0739d42e51f542018a","cfg":8,"decimals":8,"spot":"@1162","logo":"/img/stocks/eqmu.svg","kind":"stock"},{"key":"eqspcx","sym":"EQSPCX","name":"SpaceX","ticker":"SPCX","addr":"0x8264c91cedfe6cc078116083d5a3e198c16b1898","cfg":9,"decimals":8,"spot":"@1163","logo":"/img/stocks/eqspcx.svg","kind":"stock"},{"key":"eqspy","sym":"EQSPY","name":"S&P 500 ETF","ticker":"SPY","addr":"0xacc8303c19a7d686339304405e0519fc14f90b87","cfg":10,"decimals":8,"spot":"@1120","logo":"/img/stocks/eqspy.svg","kind":"stock"},{"key":"eqqqq","sym":"EQQQQ","name":"Nasdaq 100 ETF","ticker":"QQQ","addr":"0x6c4a8a4712c8deb7d14b97a35c6e96d2e83ae1b7","cfg":11,"decimals":8,"spot":"@1119","logo":"/img/stocks/eqqqq.svg","kind":"stock"},{"key":"kntq","sym":"KNTQ","name":"Kinetiq","addr":"0xe45a355d9e9cad2ad85f2d03e3ee3102a036acf0","cfg":12,"decimals":18,"spot":"@334","logo":"/img/kntq.png","kind":"crypto"}],
      contracts: { factory: '0x1328E4B186Da99df60f242e83ece471df7723411', hook: '0xcFcD7c50A3D11C07fB486071945BD7d30F1bA044', locker: '0x0b99a02EAD1E72A96c2cBB1075ec52e2481c8210', escrow: '0xcBa3dcDe8c40647F786d5f92157a01170Af65965', vault: '0x64c7c25E1A68E8b4967c497C92F1aD7F9E52180b', poolManager: '0xE2e105d3F7209A9DA11f83cCf3E7398a753823F1', positionManager: '0x72C7D3013166Ba1728B4C3FD47B71a2bE4B7a098', multicall: '0xcA11bde05977b3631167028862bE2a173976CA11', router: '0xA13f7611115752DEB2B13813BDDE16A5073e4b45', quoter: '0x379F556c5a748BD7Cc9baF0F7A344094Ac1814f5' } },
  ],
  admin: '0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b',
  official: ['0x563d07ce6086c009109b80b13b3b8eeda1d1c96e'], // $KPUMP (kinetiqpump.fun), paired with HYPE: shown with an Official tag
  hidden: ['0x392704b47ce38d6a5449eb508fc1a5d0aa18cea0'], // the test coin ($KTEST) launched to check the contracts: off the board, the ticker, the tape and search; its page still opens by link
  /* the fee flywheel: protocol fees -> splitter -> buyback and burn of $KPUMP */
  /* the bridge: Elysium is a rollup on HyperEVM. Deposits go through the rollup's Inbox on HyperEVM (depositEth, same
     address on both sides); withdrawals start on Elysium (ArbSys.withdrawEth) and are claimed on HyperEVM through the
     Outbox once the rollup has confirmed them (about 6 to 7 days). */
  bridge: {
    parent: { key: 'hyperevm', id: 999, hex: '0x3e7', name: 'HyperEVM', rpc: 'https://rpc.hyperliquid.xyz/evm', explorer: 'https://hyperevmscan.io', native: 'HYPE' },
    inbox: '0xce59f8B65ad41C9DAE4c07A0571a39824bD92cff', outbox: '0xeC6B106DfA14428FE5Eec2a4065a7be599f02728', rollup: '0x508C173dFe5F737B3493195Bf785d71fA76fD217',
    arbSys: '0x0000000000000000000000000000000000000064', nodeInterface: '0x00000000000000000000000000000000000000C8',
    claimDays: '6 to 7', anyChain: { coins: ['BTC', 'ETH', 'SOL', 'USDT', 'USDC', 'BNB'], note: 'Send from any wallet or exchange; it arrives as HYPE on HyperEVM, one click away from Elysium.' },
  },
  stake: { splitter: '0xe82E7EcBff0A8376304916ea55efCFf101193Ebe', staking: '', token: '0x563d07ce6086c009109b80B13B3B8EedA1d1c96e', symbol: 'KPUMP', stakingBps: 0, burnBps: 10000, farmBps: 0, durationDays: 7 },
  /* the AMM: our own pools for any two tokens (LP shares, 0.25% to LPs + 0.05% to the splitter per swap), and the farm
     that pays LP stakers the splitter's farm share in HYPE. Native HYPE is wrapped by the router. */
  amm: { factory: '0x262F4CFa60C950FcbA9896CbC8892C8094A53413', router: '0x47a7a624EBAAA4B629B8ED9bF38C5298C86D08D8', farm: '0x08fFb816e7632775D7bBfB7D83dD559F3D67FFf0', wnative: '0xba876237b0f021a6c6d852d6c26e107997cc5e81', lpFeeBps: 25, protocolFeeBps: 5 },
  /* the launch economics, in HYPE (the *Hype names are the quote coin's amounts) */
  econ: {
    supply: 1e9, launchFeeHype: 0.005, maxDevBuyBps: 500,
    feeBps: 300, creatorShareBps: 4000, protocolShareBps: 6000, creatorTaxMaxBps: 0,
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
