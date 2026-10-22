/* Liqio site configuration (the shared JS reads it as window.INKY, the object name it has always used).
   Liqio is the HyperEVM launchpad: one chain (999), coins paired with HYPE, USDC or a wrapped xStock, priced by
   Hyperliquid itself. live: read coins, trades and prices from the contracts (chain.js); until the Liqio contracts
   are deployed, `preview` keeps example coins on every page and the launch form in rehearsal mode.
   reownProjectId: public project id from cloud.reown.com; empty keeps the demo wallet. */
window.INKY = {
  live: true, prelaunch: false, demo: false, preview: true,
  reownProjectId: '5b1ae833abd22d348cbf5d53cf58b3b2',
  chainId: 999, native: 'HYPE', chainName: 'HyperEVM',
  rpc: 'https://rpc.hyperliquid.xyz/evm', rpcs: ['https://rpc.hyperliquid.xyz/evm', 'https://rpc.hyperlend.finance'],
  explorer: 'https://hyperevmscan.io', explorerName: 'HyperEVMScan',
  /* logsRpcs: event scans (trades, launches, holders). The official RPC serves 1,000 blocks per eth_getLogs, so the
     wide scans go to HyperLend's RPC first (up to a million blocks a call); the official one is the fallback. */
  logsRpcs: ['https://rpc.hyperlend.finance', 'https://rpc.hyperliquid.xyz/evm'],
  deployBlock: 0,
  /* WHYPE: the canonical wrapped HYPE (deposit/withdraw like WETH9); the site shows it as HYPE */
  weth: '0x5555555555555555555555555555555555555555', usdg: '',
  /* Liqio indexer: empty = read history from the chain directly */
  api: '',
  /* Liqio contracts on HyperEVM: filled in at deploy (see contracts/deployments/liqio-hyperevm.json) */
  contracts: {"factory": "", "hook": "", "router": "", "tokenDeployer": "", "oracle": "", "poolManager": "0x12D4Fd9C5DeDd00ab8a0bCe2CF0167bbf94b6B1F"},
  /* quoters on HyperEVM, used to price HYPE <-> pair along a route: Uniswap V4Quoter, PRJX QuoterV2 (V3 fork), Multicall3 */
  quoters: {v4: '0x108Bfe38532C98f8Cd8D7Ab49c9dDAa3675a1c5e', v3: '0x239F11a7A3E08f2B8110D4CA9F6B95d4c8865258', multicall: '0xcA11bde05977b3631167028862bE2a173976CA11'},
  /* crypto pairs besides HYPE: a coin can also pair with a stablecoin. `hl` is the Hyperliquid market the site reads
     the USD price from (allMids); `fixed` is a constant USD price. */
  cryptoPairs: [
    {symbol:'USDC', ticker:'USDC', name:'USD Coin', address:'0xb88339cb7199b77e23db6e890353e22632ba630f', decimals:6, logo:'/img/usdc.svg', fixed:1, route:[{dex:2,pool:'0x6c9A33E3b592C0d65B3Ba59355d5Be0d38259285'}]}
  ],
  /* stocks: wrapped xStocks on HyperEVM (Backed Finance). Each is an ERC-4626 share of the xStock, so one wrapped token
     is worth a little more than one share and accrues on its own; `erc4626` tells the site to scale the stock price by
     the wrapper's ratio. `hl` names the Hyperliquid market whose oracle price the stock follows (perps on the xyz
     HIP-3 dex), with `mult` when the token tracks a fraction of it (SPY ≈ S&P 500 / 10). `route` is how the router
     turns HYPE into the stock and back: the PRJX (Uniswap V3 fork) 1% pool against WHYPE. Stocks with no route trade
     in the stock itself (buyWithPair / sellForPair) and the creator's first buy is off.
     Pool depth checked 2026-10-22. Every xStock (~1,350 products) has the same contract address on every EVM chain
     and bridges to HyperEVM over CCIP; more are listed here as their pools get depth. */
  stocks: (function(){
    const prjx=pool=>[{dex:2,pool}];
    const S=(symbol,name,address,underlying,hl,mult,logo,route)=>({symbol,ticker:symbol.replace(/^w/,'').replace(/x$/,''),name,address:address.toLowerCase(),underlying:underlying.toLowerCase(),decimals:18,erc4626:true,hl,mult:mult||1,logo,route:route||null});
    return [
      S('wNVDAx','NVIDIA','0xa8ddb5cd96b5222afe198316e9a57caa642850d5','0xc845b2894dBddd03858fd2D643B4eF725fE0849d','xyz:NVDA',1,'/img/s-NVDAx.png',prjx('0x4bc0C3C0947d968043762149EAa51aBbF35C2687')),
      S('wSPYx','SPDR S&P 500 ETF','0xe7e553cd128f0011777323a0b44a7b96ea1cb540','0x90A2a4c76b5D8c0bc892A69EA28Aa775a8f2dD48','xyz:SP500',0.1,'/img/s-SPYx.png',prjx('0xe35A998BC42fE387C0bDa7E489DCD2Ca15F886f9')),
      S('wSPCXx','SpaceX','0x8e2eed8b8b5e13ea7bf38e50d7821d2c57309072','0x68fa48B1C2FE52b3D776E1953e0E782b5044Ce28','xyz:SPCX',1,'/img/s-SPCXx.png',prjx('0x6Db0180b387F1bB1B46ef6B075A775E6BB6D3E2e')),
      S('wGMEx','GameStop','0x459d3ae62b86cc6125e06260dddfd3afed24a877','0xE5f6d3b2405ABdfE6F660e63202B25D23763160d','xyz:GME',1,'https://financialmodelingprep.com/image-stock/GME.png',prjx('0x9f21235031ad8B1aDa90EAd9c4717B161C2c0Cda')),
      S('wMUx','Micron Technology','0xe2047ee3bddb5c99ae428ab83df63f8730698e30','0xf6a873BAe4Ba1B304e45dF52A4b7D176E1C6a8c4','xyz:MU',1,'https://financialmodelingprep.com/image-stock/MU.png'),
      S('wSKHYx','SK hynix','0x6215a58ed045d71f2561aaabe54f4c885c522998','0x58100046a4Afcd4eE4faDbD4244f3f895a341c56','xyz:SKHY',1,'https://financialmodelingprep.com/image-stock/SKHY.png'),
      S('wQQQx','Invesco QQQ','0x4c1ae29c159838fc1b224636e28e086eb69101f7','0xa753A7395cAe905Cd615Da0B82A53E0560f250af','',1,'/img/s-QQQx.png')
    ];
  })(),
  stocksOnly: false,
  /* chains: Liqio lives on HyperEVM only. launchGas is the gas one launch uses (clone coin + pool + wiring). */
  chains: [
    {key:'hyper', code:'HYPE', name:'HyperEVM', short:'HyperEVM', chainId:999, native:'HYPE', cg:'hyperliquid', logo:'/img/chains/hyper.png', color:'#33e5c2', main:true, live:true, stocks:'xStocks',
     rpc:'https://rpc.hyperliquid.xyz/evm', explorer:'https://hyperevmscan.io', poolManager:'0x12D4Fd9C5DeDd00ab8a0bCe2CF0167bbf94b6B1F', launchGas:1200000}
  ],
  /* launch fee: gas plus this margin */
  launchMarginBps: 2000,
  /* the creator's first buy, in HYPE: the form caps it here */
  devBuyMax: 50,
  site: 'https://liqio.fun',
  x: 'liqiofun',
  admin: '0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b'
};
