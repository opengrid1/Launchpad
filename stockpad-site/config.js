/* Equo site configuration (internal object name kept as INKY so the shared JS needs no rename).
   live: read tokens, trades and prices from the Ethereum contracts (chain.js); prelaunch: preview only, no chain reads.
   reownProjectId: public project id from cloud.reown.com; empty keeps the demo wallet. */
window.INKY = {
  // the creator's part of each fee after the holder and buyback pots (the platform keeps the rest); the hook's
  // CREATOR_SPLIT_BPS constant is read from chain and wins, this is only the value until it is read
  creatorSplitBps: 7000,
  live: true, prelaunch: false,
  /* v1:false skips the first contracts' chain reader (chain.js); the site runs on Equo v2 (v2.js) only */
  v1: false,
  reownProjectId: '5b1ae833abd22d348cbf5d53cf58b3b2',
  chainId: 1, rpc: 'https://ethereum-rpc.publicnode.com', rpcs: ['https://ethereum-rpc.publicnode.com', 'https://rpc.mevblocker.io'], explorer: 'https://etherscan.io',
  /* logsRpcs: event scans (trades, launches, holders) go here. The first full scan needs an RPC that
     serves eth_getLogs over the whole range since deployBlock (publicnode's free tier refuses ranges
     older than ~36 hours; rpc.flashbots.net answers but silently drops logs, so it is not listed).
     Later scans are incremental and small, so publicnode works as the fallback for those. */
  logsRpcs: ['https://rpc.mevblocker.io', 'https://ethereum-rpc.publicnode.com'],
  deployBlock: 26274031,
  weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', usdg: '',
  /* Equo indexer (indexer/ in the repo): history for every chain. Empty = read history from the chains directly. */
  api: 'self',
  /* Equo v2 on Ethereum (the footer's addresses); every chain's v2 contracts are in `chains` below.
     See contracts/deployments/equo2-<chain>.json (deployed 2026-10-27). */
  contracts: {"factory": "0x05A6f357c791A4cEf0CbE4dCEc9014a35D30879A", "hook": "0x6a03Ac8C887cDec254cAde95a9B1AE83aB2a28Cc", "router": "0xD4E8bCecDD1c142B0517Ff3Cc0a4f181c1686d2a", "tokenDeployer": "0x867b598dFD5A889628766e53C563f71B4Fd5Ce44", "poolManager": "0x000000000004444c5dc75cB358380D2e3dE08A90"},
  /* stocks: none. Equo pairs every coin with its chain's native coin (ETH, BNB, HYPE, MON, SOL). */
  stocks: [],
  stocksOnly: false,
  /* chains: one Equo v2 coin launches on several of these at once, opening at the same USD price, one 1B pool per
     chain, its own coin address on each chain, bridged with LayerZero. v2: that chain's Equo v2 factory, hook and
     router. launchGas is the gas one launch leg uses (coin, pool and wiring to seven chains), measured on forks.
     Explorers from Etherscan's chain list; pool managers from Uniswap's v4 deployments; endpoint ids from
     LayerZero's deployments (checked 2026-10-25). */
  chains: [
    {key:'eth', blockSec:12,      code:'ETH',  name:'Ethereum',  short:'Ethereum', chainId:1,     native:'ETH',  cg:'ethereum',    logo:'/img/chains/eth.png',      color:'#8c9eff', main:true,  live:true,
     rpc:'https://ethereum-rpc.publicnode.com',      explorer:'https://etherscan.io',     lzEid:30101, poolManager:'0x000000000004444c5dc75cB358380D2e3dE08A90', launchGas:7700000, v2:{factory:'0x05A6f357c791A4cEf0CbE4dCEc9014a35D30879A', hook:'0x6a03Ac8C887cDec254cAde95a9B1AE83aB2a28Cc', router:'0xD4E8bCecDD1c142B0517Ff3Cc0a4f181c1686d2a'}},
    {key:'base', blockSec:2,     code:'BASE', name:'Base',      short:'Base',     chainId:8453,  native:'ETH',  cg:'ethereum',    logo:'/img/chains/base.png',     color:'#3c6bff', main:false, live:true,
     rpc:'https://base-rpc.publicnode.com',          explorer:'https://basescan.org',     lzEid:30184, poolManager:'0x498581fF718922c3f8e6A244956aF099B2652b2b', launchGas:7700000, v2:{factory:'0x1091BD5933582DFe867B948ca1470C925aa0F994', hook:'0xeb0aeB3c55D0594A5Add43ce808198470b15e8cc', router:'0xc1eB59F1B13f19A08b9Ac2daE4fED1EA273AC917'}},
    {key:'bsc', blockSec:0.75,      code:'BSC',  name:'BNB Chain', short:'BNB',      chainId:56,    native:'BNB',  cg:'binancecoin', logo:'/img/chains/bsc.png',      color:'#f0b90b', main:false, live:true,
     rpc:'https://bsc-rpc.publicnode.com',           explorer:'https://bscscan.com',      lzEid:30102, poolManager:'0x28e2Ea090877bF75740558f6BFB36A5ffeE9e9dF', launchGas:7700000, v2:{factory:'0x2034c0ea26CE2bC4575a18600aFE8bE230Edcd86', hook:'0x3966C897563d974696EaE6C275170551069e28CC', router:'0x1b0e8e8e8ee4b8066A0B28BFd9774C381b6dDE7E'}},
    {key:'arbitrum', blockSec:0.25, code:'ARB',  name:'Arbitrum',  short:'Arbitrum', chainId:42161, native:'ETH',  cg:'ethereum',    logo:'/img/chains/arbitrum.png', color:'#4aa3ff', main:false, live:true,
     rpc:'https://arbitrum-one-rpc.publicnode.com',  explorer:'https://arbiscan.io',      lzEid:30110, poolManager:'0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32', launchGas:7700000, v2:{factory:'0x2034c0ea26CE2bC4575a18600aFE8bE230Edcd86', hook:'0x9108b68Edb06244CD4590BbD27e8AfCC45a528cC', router:'0x1b0e8e8e8ee4b8066A0B28BFd9774C381b6dDE7E'}},
    {key:'hyper', blockSec:1,    code:'HYPE', name:'HyperEVM',  short:'Hyper',    chainId:999,   native:'HYPE', cg:'hyperliquid', logo:'/img/chains/hyper.png',    color:'#97fce4', main:false, live:true,
     rpc:'https://rpc.hyperliquid.xyz/evm',          explorer:'https://hyperevmscan.io',  lzEid:30367, poolManager:'0x12D4Fd9C5DeDd00ab8a0bCe2CF0167bbf94b6B1F', launchGas:7700000, v2:{factory:'0xf32FF256F621645b8D9BEDa21B3f9d5384475883', hook:'0x13b9595c0691871f62a01F5C5A8341635eda28CC', router:'0x118460aDeAc3aA6Cb9836EEa156FbC94aCdD404A'}},
    {key:'monad', blockSec:0.4,    code:'MON',  name:'Monad',     short:'Monad',    chainId:143,   native:'MON',  cg:'monad',       logo:'/img/chains/monad.png',    color:'#836ef9', main:false, live:true,
     rpc:'https://rpc.monad.xyz',                    explorer:'https://monadscan.com',    lzEid:30390, poolManager:'0x188d586Ddcf52439676Ca21A244753fA19F9Ea8e', launchGas:7700000, v2:{factory:'0xf32FF256F621645b8D9BEDa21B3f9d5384475883', hook:'0xb28817fc2E7DFdA54F1450B10544Ad0a010Be8cc', router:'0x118460aDeAc3aA6Cb9836EEa156FbC94aCdD404A'}},
    {key:'megaeth', blockSec:1,  code:'MEGA', name:'MegaETH',   short:'MegaETH',  chainId:4326,  native:'ETH',  cg:'ethereum',    logo:'/img/chains/megaeth.png',  color:'#ff7aa2', main:false, live:true,
     rpc:'https://mainnet.megaeth.com/rpc',          explorer:'https://mega.etherscan.io', lzEid:30398, poolManager:'0xaCB7e78fa05D562e0A5D3089ec896D57D057d38E', launchGas:7700000, v2:{factory:'0x05A6f357c791A4cEf0CbE4dCEc9014a35D30879A', hook:'0x6ccc4F076B9B5650be6e09Dd7b646310292B68cC', router:'0x2b724d4Dc43940BEc52A2f5Da49b245F72C2f377'}},
    {key:'unichain', blockSec:1, code:'UNI',  name:'Unichain',  short:'Unichain', chainId:130,   native:'ETH',  cg:'ethereum',    logo:'/img/chains/unichain.png', color:'#f50db4', main:false, live:true,
     rpc:'https://mainnet.unichain.org',             explorer:'https://uniscan.xyz',      lzEid:30320, poolManager:'0x1F98400000000000000000000000000000000004', launchGas:7700000, v2:{factory:'0xf32FF256F621645b8D9BEDa21B3f9d5384475883', hook:'0x964b90640B78cFB0482f768f42150cF9aC6968cC', router:'0x118460aDeAc3aA6Cb9836EEa156FbC94aCdD404A'}}
  ],
  /* launch fee: gas on every chosen chain plus this margin; bridge: LayerZero fees */
  launchMarginBps: 2000, bridgeFeeBps: 20, fastFeeBps: 20,
  /* every chain's pool opens with a first buy (the factory's minFirstBuy): the creator's dev buy on the chain they pay
     on, a seed buy of about this much on each other chain, paid in the launch fee. blockSec turns anti-snipe minutes
     into each chain's blocks (approximate block times). */
  minFirstBuyEth: 0.001, seedUsd: 4,
  site: 'https://stockpad-v2.vercel.app',
  admin: '0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b',
  /* coins kept out of the lists (still open by direct link) */
  hiddenCoins: []
};
