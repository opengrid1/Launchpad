/* Equo site configuration (internal object name kept as INKY so the shared JS needs no rename).
   live: read tokens, trades and prices from the Ethereum contracts (chain.js); prelaunch: preview only, no chain reads.
   reownProjectId: public project id from cloud.reown.com; empty keeps the demo wallet. */
window.INKY = {
  // the creator's part of each fee after the holder and buyback pots (the platform keeps the rest); the hook's
  // CREATOR_SPLIT_BPS constant is read from chain and wins, this is only the value until it is read
  creatorSplitBps: 7000,
  live: true, prelaunch: false, demo: false,
  reownProjectId: '5b1ae833abd22d348cbf5d53cf58b3b2',
  chainId: 1, rpc: 'https://ethereum-rpc.publicnode.com', rpcs: ['https://ethereum-rpc.publicnode.com', 'https://rpc.mevblocker.io'], explorer: 'https://etherscan.io',
  /* logsRpcs: event scans (trades, launches, holders) go here. The first full scan needs an RPC that
     serves eth_getLogs over the whole range since deployBlock (publicnode's free tier refuses ranges
     older than ~36 hours; rpc.flashbots.net answers but silently drops logs, so it is not listed).
     Later scans are incremental and small, so publicnode works as the fallback for those. */
  logsRpcs: ['https://rpc.mevblocker.io', 'https://ethereum-rpc.publicnode.com'],
  deployBlock: 26235330,
  weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', usdg: '',
  /* Equo indexer (indexer/ in the repo): history for every chain. Empty = read history from the chains directly. */
  api: 'self',
  /* Equo contracts (v3), deployed 2026-10-20: see contracts/deployments/equo-mainnet.json */
  contracts: {"factory": "0x7Eb4CC330866Af46b2fDfBce41686CC74778d325", "hook": "0xbe1FF9acc59F73Ae311810Cb74e162a47E2e40Cc", "router": "0x4055F9abd07caBC16788d499A935a297968E09c8", "tokenDeployer": "0x9289DD47cfb34acE7a3a97666542aBa18f7c5e48", "poolManager": "0x000000000004444c5dc75cB358380D2e3dE08A90"},
  /* stocks: none. Equo pairs every coin with its chain's native coin (ETH, BNB, HYPE, MON, SOL). */
  stocks: [],
  stocksOnly: false,
  /* chains: one coin, live on several chains at the same opening price, one pool per chain, the same coin
     address on every EVM chain, bridged with LayerZero. Ethereum is the main chain. `live` is false until that
     chain's contracts are deployed; the site shows those chains, but only live chains launch and trade.
     launchGas is the gas one launch uses on that chain (factory + pool + wiring), for the launch cost quote.
     Explorers from Etherscan's chain list; pool managers from Uniswap's v4 deployments; endpoint ids from
     LayerZero's deployments (checked 2026-10-25). */
  chains: [
    {key:'eth', blockSec:12,      code:'ETH',  name:'Ethereum',  short:'Ethereum', chainId:1,     native:'ETH',  cg:'ethereum',    logo:'/img/chains/eth.png',      color:'#8c9eff', main:true,  live:true,
     rpc:'https://ethereum-rpc.publicnode.com',      explorer:'https://etherscan.io',     lzEid:30101, poolManager:'0x000000000004444c5dc75cB358380D2e3dE08A90', launchGas:7290000},
    {key:'base', blockSec:2,     code:'BASE', name:'Base',      short:'Base',     chainId:8453,  native:'ETH',  cg:'ethereum',    logo:'/img/chains/base.png',     color:'#3c6bff', main:false, live:false,
     rpc:'https://base-rpc.publicnode.com',          explorer:'https://basescan.org',     lzEid:30184, poolManager:'0x498581fF718922c3f8e6A244956aF099B2652b2b', launchGas:7290000},
    {key:'bsc', blockSec:0.75,      code:'BSC',  name:'BNB Chain', short:'BNB',      chainId:56,    native:'BNB',  cg:'binancecoin', logo:'/img/chains/bsc.png',      color:'#f0b90b', main:false, live:false,
     rpc:'https://bsc-rpc.publicnode.com',           explorer:'https://bscscan.com',      lzEid:30102, poolManager:'0x28e2Ea090877bF75740558f6BFB36A5ffeE9e9dF', launchGas:7290000},
    {key:'arbitrum', blockSec:0.25, code:'ARB',  name:'Arbitrum',  short:'Arbitrum', chainId:42161, native:'ETH',  cg:'ethereum',    logo:'/img/chains/arbitrum.png', color:'#4aa3ff', main:false, live:false,
     rpc:'https://arbitrum-one-rpc.publicnode.com',  explorer:'https://arbiscan.io',      lzEid:30110, poolManager:'0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32', launchGas:7290000},
    {key:'hyper', blockSec:1,    code:'HYPE', name:'HyperEVM',  short:'Hyper',    chainId:999,   native:'HYPE', cg:'hyperliquid', logo:'/img/chains/hyper.png',    color:'#97fce4', main:false, live:false,
     rpc:'https://rpc.hyperliquid.xyz/evm',          explorer:'https://hyperevmscan.io',  lzEid:30367, poolManager:'0x12D4Fd9C5DeDd00ab8a0bCe2CF0167bbf94b6B1F', launchGas:7290000},
    {key:'monad', blockSec:0.4,    code:'MON',  name:'Monad',     short:'Monad',    chainId:143,   native:'MON',  cg:'monad',       logo:'/img/chains/monad.png',    color:'#836ef9', main:false, live:false,
     rpc:'https://rpc.monad.xyz',                    explorer:'https://monadscan.com',    lzEid:30390, poolManager:'0x188d586Ddcf52439676Ca21A244753fA19F9Ea8e', launchGas:7290000},
    {key:'megaeth', blockSec:1,  code:'MEGA', name:'MegaETH',   short:'MegaETH',  chainId:4326,  native:'ETH',  cg:'ethereum',    logo:'/img/chains/megaeth.png',  color:'#ff7aa2', main:false, live:false,
     rpc:'https://mainnet.megaeth.com/rpc',          explorer:'https://mega.etherscan.io', lzEid:30398, poolManager:'0xaCB7e78fa05D562e0A5D3089ec896D57D057d38E', launchGas:7290000},
    {key:'unichain', blockSec:1, code:'UNI',  name:'Unichain',  short:'Unichain', chainId:130,   native:'ETH',  cg:'ethereum',    logo:'/img/chains/unichain.png', color:'#f50db4', main:false, live:false,
     rpc:'https://mainnet.unichain.org',             explorer:'https://uniscan.xyz',      lzEid:30320, poolManager:'0x1F98400000000000000000000000000000000004', launchGas:7290000},
    /* Solana is not an EVM chain: no Uniswap v4 and no shared address. A coin there is its own Solana token with its
       own address, linked to the EVM chains through LayerZero. Shown as coming; nothing on the site sends to it. */
    {key:'sol', blockSec:0.4,      code:'SOL',  name:'Solana',    short:'Solana',   chainId:null,  native:'SOL',  cg:'solana',      logo:'/img/chains/sol.png',      color:'#14f195', main:false, live:false, evm:false, dex:'Meteora',
     rpc:'https://api.mainnet-beta.solana.com',      explorer:'https://solscan.io',       lzEid:30168, poolManager:'',                                           launchGas:0}
  ],
  /* launch fee: gas on every chosen chain plus this margin; bridge: LayerZero fees */
  launchMarginBps: 2000, bridgeFeeBps: 20, fastFeeBps: 20,
  /* every chain's pool opens with a first buy (the factory's minFirstBuy): the creator's dev buy on the chain they pay
     on, a seed buy of about this much on each other chain, paid in the launch fee. blockSec turns anti-snipe minutes
     into each chain's blocks (approximate block times). */
  minFirstBuyEth: 0.001, seedUsd: 4,
  site: 'https://stockpad-v2.vercel.app',
  admin: '0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b'
};
