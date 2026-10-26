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
  deployBlock: 26274031,
  weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', usdg: '',
  /* Equo indexer (indexer/ in the repo): history for every chain. Empty = read history from the chains directly. */
  api: 'self',
  /* Equo contracts, deployed 2026-10-26 (70/30, cashback, collect): see contracts/deployments/equo-mainnet.json */
  contracts: {"factory": "0x6b82ddCc081CB2bA668C5190139D16A4dBb2ef52", "hook": "0x8b54AaFdCE7BD99e6d9E815510658210355cC0CC", "router": "0x4f91CbFc45e76256Cd350A21Fe68Ec630731f492", "tokenDeployer": "0x502Dc911055B057aBBE9605d72462A66fC2885a5", "poolManager": "0x000000000004444c5dc75cB358380D2e3dE08A90"},
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
     rpc:'https://ethereum-rpc.publicnode.com',      explorer:'https://etherscan.io',     lzEid:30101, poolManager:'0x000000000004444c5dc75cB358380D2e3dE08A90', launchGas:4000000, factory:'0x6b82ddCc081CB2bA668C5190139D16A4dBb2ef52', hook:'0x8b54AaFdCE7BD99e6d9E815510658210355cC0CC', router:'0x4f91CbFc45e76256Cd350A21Fe68Ec630731f492'},
    {key:'base', blockSec:2,     code:'BASE', name:'Base',      short:'Base',     chainId:8453,  native:'ETH',  cg:'ethereum',    logo:'/img/chains/base.png',     color:'#3c6bff', main:false, live:false,
     rpc:'https://base-rpc.publicnode.com',          explorer:'https://basescan.org',     lzEid:30184, poolManager:'0x498581fF718922c3f8e6A244956aF099B2652b2b', launchGas:4000000, factory:'0x3258C1D4473e9b91ddD6d92517F0929f49F5E1da', hook:'0x3C9c1a3f5c4D34D00fFeAc85d002f63BAc41C0cC', router:'0x917D12Ff9674290935a75b657Cd48CF64c23a099'},
    {key:'bsc', blockSec:0.75,      code:'BSC',  name:'BNB Chain', short:'BNB',      chainId:56,    native:'BNB',  cg:'binancecoin', logo:'/img/chains/bsc.png',      color:'#f0b90b', main:false, live:false,
     rpc:'https://bsc-rpc.publicnode.com',           explorer:'https://bscscan.com',      lzEid:30102, poolManager:'0x28e2Ea090877bF75740558f6BFB36A5ffeE9e9dF', launchGas:4000000, factory:'0x0d0c4f86375a8361CDD2B5Df04Cf6540a2896c6d', hook:'0xa282b881B290eAb4BAdEB049Af4B1822811180cc', router:'0x9E679424bc13A466aAe79DF17fC76506695B5bbf'},
    {key:'arbitrum', blockSec:0.25, code:'ARB',  name:'Arbitrum',  short:'Arbitrum', chainId:42161, native:'ETH',  cg:'ethereum',    logo:'/img/chains/arbitrum.png', color:'#4aa3ff', main:false, live:false,
     rpc:'https://arbitrum-one-rpc.publicnode.com',  explorer:'https://arbiscan.io',      lzEid:30110, poolManager:'0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32', launchGas:4000000, factory:'0x4f91CbFc45e76256Cd350A21Fe68Ec630731f492', hook:'0xfecB10aD45782011d125f44B85da47EC9B5940CC', router:'0x0d0c4f86375a8361CDD2B5Df04Cf6540a2896c6d'},
    {key:'hyper', blockSec:1,    code:'HYPE', name:'HyperEVM',  short:'Hyper',    chainId:999,   native:'HYPE', cg:'hyperliquid', logo:'/img/chains/hyper.png',    color:'#97fce4', main:false, live:false,
     rpc:'https://rpc.hyperliquid.xyz/evm',          explorer:'https://hyperevmscan.io',  lzEid:30367, poolManager:'0x12D4Fd9C5DeDd00ab8a0bCe2CF0167bbf94b6B1F', launchGas:4000000, factory:'0x0d0c4f86375a8361CDD2B5Df04Cf6540a2896c6d', hook:'0xF215685b8e9ddc0e31a9aA9f43C51042C7d080cC', router:'0x9E679424bc13A466aAe79DF17fC76506695B5bbf'},
    {key:'monad', blockSec:0.4,    code:'MON',  name:'Monad',     short:'Monad',    chainId:143,   native:'MON',  cg:'monad',       logo:'/img/chains/monad.png',    color:'#836ef9', main:false, live:false,
     rpc:'https://rpc.monad.xyz',                    explorer:'https://monadscan.com',    lzEid:30390, poolManager:'0x188d586Ddcf52439676Ca21A244753fA19F9Ea8e', launchGas:4000000, factory:'0x4f91CbFc45e76256Cd350A21Fe68Ec630731f492', hook:'0x1aA99bACdfaC82C488BC4c2756da24d618c380cC', router:'0x0d0c4f86375a8361CDD2B5Df04Cf6540a2896c6d'},
    {key:'megaeth', blockSec:1,  code:'MEGA', name:'MegaETH',   short:'MegaETH',  chainId:4326,  native:'ETH',  cg:'ethereum',    logo:'/img/chains/megaeth.png',  color:'#ff7aa2', main:false, live:false,
     rpc:'https://mainnet.megaeth.com/rpc',          explorer:'https://mega.etherscan.io', lzEid:30398, poolManager:'0xaCB7e78fa05D562e0A5D3089ec896D57D057d38E', launchGas:4000000, factory:'0x9E679424bc13A466aAe79DF17fC76506695B5bbf', hook:'0x47a94C1cAceF22027756687F1Bf20031d44E00cc', router:'0x245EBB207bb18bB4E7E3A81aF9f7E69a43b63DD0'},
    {key:'unichain', blockSec:1, code:'UNI',  name:'Unichain',  short:'Unichain', chainId:130,   native:'ETH',  cg:'ethereum',    logo:'/img/chains/unichain.png', color:'#f50db4', main:false, live:false,
     rpc:'https://mainnet.unichain.org',             explorer:'https://uniscan.xyz',      lzEid:30320, poolManager:'0x1F98400000000000000000000000000000000004', launchGas:4000000, factory:'0x0d0c4f86375a8361CDD2B5Df04Cf6540a2896c6d', hook:'0xb12DB7Ae3CaBc9eD9e46908B4c49a1A92e1240cC', router:'0x9E679424bc13A466aAe79DF17fC76506695B5bbf'},
    /* Solana is not an EVM chain: no Uniswap v4 and no shared address. A coin there is its own Token-2022 mint with its
       own address and a Meteora DAMM v2 pool (solana/ in the repo; program deployed 2026-10-26). Not bridged yet, and
       the site has no Solana wallet yet, so nothing on the site sends to it. */
    {key:'sol', blockSec:0.4,      code:'SOL',  name:'Solana',    short:'Solana',   chainId:null,  native:'SOL',  cg:'solana',      logo:'/img/chains/sol.png',      color:'#14f195', main:false, live:false, evm:false, dex:'Meteora',
     program:'6mdh7toDGpPEk8CYokVLi2aQMLDnB9jVkzhP5n9Dt4wR', config:'9UtTwTMw5vGcfj1RL1SXhvym4XRvwNWpkbJpDp7dWQgg',
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
