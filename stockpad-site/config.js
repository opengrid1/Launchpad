/* Equo site configuration (internal object name kept as INKY so the shared JS needs no rename).
   live: read tokens, trades and prices from the Ethereum contracts (chain.js); prelaunch: preview only, no chain reads.
   reownProjectId: public project id from cloud.reown.com; empty keeps the demo wallet. */
window.INKY = {
  live: true, prelaunch: false, demo: false,
  reownProjectId: '5b1ae833abd22d348cbf5d53cf58b3b2',
  chainId: 1, rpc: 'https://ethereum-rpc.publicnode.com', rpcs: ['https://ethereum-rpc.publicnode.com', 'https://rpc.mevblocker.io'], explorer: 'https://etherscan.io',
  /* logsRpcs: event scans (trades, launches, holders) go here. The first full scan needs an RPC that
     serves eth_getLogs over the whole range since deployBlock (publicnode's free tier refuses ranges
     older than ~36 hours; rpc.flashbots.net answers but silently drops logs, so it is not listed).
     Later scans are incremental and small, so publicnode works as the fallback for those. */
  logsRpcs: ['https://rpc.mevblocker.io', 'https://ethereum-rpc.publicnode.com'],
  deployBlock: 26213781,
  weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', usdg: '',
  contracts: {"factory": "0xBaa02255Dc8419A4266Be406F72E11De1B901E39", "hook": "0x0bcD3394Dffc047D146E76bCc461d8bEAC9fC0CC", "router": "0xC7ED71a86754D6a3928225f613282Ac65B972678", "tokenDeployer": "0xEE03B300BBb2395b0de6e6AaEaE30432b81ef332", "poolManager": "0x000000000004444c5dc75cB358380D2e3dE08A90"},
  /* stocks: tokenized stocks a coin can be paired with instead of ETH (Ondo "on" tokens on mainnet).
     The factory prices launches through its oracle, which already lists these; `route` is how the
     OneRouter turns ETH into the stock for buys and back for sells: hop 1 WETH -> USDC on the
     Uniswap v3 0.05% pool, hop 2 USDC -> stock on the pool the oracle uses (dex 2 = v3 pool
     address, dex 3 = v4 pool key). Only stocks with real on-chain depth are listed. */
  stocks: (function(){
    const USDC='0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', WETH_USDC={dex:2,pool:'0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640'};
    const v3=pool=>[WETH_USDC,{dex:2,pool}], v4=(stock,fee,tickSpacing)=>[WETH_USDC,{dex:3,key:{currency0:stock,currency1:USDC,fee,tickSpacing,hooks:'0x0000000000000000000000000000000000000000'}}];
    const logo=t=>'https://financialmodelingprep.com/image-stock/'+t+'.png';
    return [
      {symbol:'TSLAon', ticker:'TSLA', name:'Tesla',               address:'0xf6b1117ec07684d3958cad8beb1b302bfd21103f', decimals:18, logo:logo('TSLA'),  route:v3('0x31227b50eccdc9c589826aa2d9e7c5619b1895da')},
      {symbol:'NVDAon', ticker:'NVDA', name:'NVIDIA',              address:'0x2d1f7226bd1f780af6b9a49dcc0ae00e8df4bdee', decimals:18, logo:logo('NVDA'),  route:v4('0x2d1f7226bd1f780af6b9a49dcc0ae00e8df4bdee',5100,51)},
      {symbol:'AAPLon', ticker:'AAPL', name:'Apple',               address:'0x14c3abf95cb9c93a8b82c1cdcb76d72cb87b2d4c', decimals:18, logo:logo('AAPL'),  route:v3('0xad82c9eb065a5cfed71db087e4a52c8a09c69921')},
      {symbol:'GOOGLon',ticker:'GOOGL',name:'Alphabet',            address:'0xba47214edd2bb43099611b208f75e4b42fdcfedc', decimals:18, logo:logo('GOOGL'), route:v3('0x39fcb1935f6ccb0a106d05eb928205c59646af57')},
      {symbol:'METAon', ticker:'META', name:'Meta Platforms',      address:'0x59644165402b611b350645555b50afb581c71eb2', decimals:18, logo:logo('META'),  route:v4('0x59644165402b611b350645555b50afb581c71eb2',50000,500)},
      {symbol:'GMEon',  ticker:'GME',  name:'GameStop',            address:'0x71d24baeb0a033ec5f90ff65c4210545af378d97', decimals:18, logo:logo('GME'),   route:v4('0x71d24baeb0a033ec5f90ff65c4210545af378d97',50000,500)},
      {symbol:'MCDon',  ticker:'MCD',  name:"McDonald's",          address:'0x4c82c8cd9a218612dce60b156b73a36705645e3b', decimals:18, logo:logo('MCD'),   route:v4('0x4c82c8cd9a218612dce60b156b73a36705645e3b',50000,500)},
      {symbol:'SPYon',  ticker:'SPY',  name:'S&P 500 ETF',         address:'0xfedc5f4a6c38211c1338aa411018dfaf26612c08', decimals:18, logo:logo('SPY'),   route:v3('0x5638bbde046ec2efc7c8f3fd8dc5a9a1016f7eeb')},
      {symbol:'QQQon',  ticker:'QQQ',  name:'Nasdaq 100 ETF',      address:'0x0e397938c1aa0680954093495b70a9f5e2249aba', decimals:18, logo:logo('QQQ'),   route:v4('0x0e397938c1aa0680954093495b70a9f5e2249aba',6500,65)},
      {symbol:'SLVon',  ticker:'SLV',  name:'Silver Trust',        address:'0xf3e4872e6a4cf365888d93b6146a2baa7348f1a4', decimals:18, logo:logo('SLV'),   route:v3('0xeeb8f880ead7281a301ef2e6791a6bbe790603ed')},
      {symbol:'SGOVon', ticker:'SGOV', name:'0-3 Month Treasury',  address:'0x8de5d49725550f7b318b2fa0f1b1f118e98e8d0f', decimals:18, logo:logo('SGOV'),  route:v4('0x8de5d49725550f7b318b2fa0f1b1f118e98e8d0f',38000,380)}
    ];
  })(),
  /* Equo: list only stock-paired coins; ETH-paired coins on the same factory stay on their own site. */
  stocksOnly: true,
  site: 'https://stockpad-v2.vercel.app',
  admin: '0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b'
};
