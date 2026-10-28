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
  /* gen: which deployment's coins the site lists (3: the fresh one with Solana and Ink) */
  gen: 3,
  chains: [
    {key:'eth', blockSec:12,      code:'ETH',  name:'Ethereum',  short:'Ethereum', chainId:1,     native:'ETH',  cg:'ethereum',    logo:'/img/chains/eth.png',      color:'#8c9eff', main:true,  live:true,
     rpc:'https://ethereum-rpc.publicnode.com',      explorer:'https://etherscan.io',     lzEid:30101, poolManager:'0x000000000004444c5dc75cB358380D2e3dE08A90', launchGas:8700000, v2:{factory:'0x44D016b20a0c8f0A3791B3Ea10Ff09af0eCE1DC2', hook:'0x485E4328b0F4C5c11155bFeC43aF1c4D9462A8cC', router:'0xE4767a75518E14D15F34DcE4155CC4256Ff3D0f9'}},
    {key:'base', blockSec:2,     code:'BASE', name:'Base',      short:'Base',     chainId:8453,  native:'ETH',  cg:'ethereum',    logo:'/img/chains/base.png',     color:'#3c6bff', main:false, live:true,
     rpc:'https://base-rpc.publicnode.com',          explorer:'https://basescan.org',     lzEid:30184, poolManager:'0x498581fF718922c3f8e6A244956aF099B2652b2b', launchGas:8700000, v2:{factory:'0xf51667a3607ca78e81344d95918651A5768621aB', hook:'0x6E58deD0b0D602CdE4715C88bFE2Ad9AdFd068CC', router:'0x7E39AF0100bbFF4Cd8C3d65bCcCD0A83c1694734'}},
    {key:'bsc', blockSec:0.75,      code:'BSC',  name:'BNB Chain', short:'BNB',      chainId:56,    native:'BNB',  cg:'binancecoin', logo:'/img/chains/bsc.png',      color:'#f0b90b', main:false, live:true,
     rpc:'https://bsc-rpc.publicnode.com',           explorer:'https://bscscan.com',      lzEid:30102, poolManager:'0x28e2Ea090877bF75740558f6BFB36A5ffeE9e9dF', launchGas:8700000, v2:{factory:'0x44D016b20a0c8f0A3791B3Ea10Ff09af0eCE1DC2', hook:'0x22E64aeF76ec8299b66d412b4921507B927da8cc', router:'0xE4767a75518E14D15F34DcE4155CC4256Ff3D0f9'}},
    {key:'arbitrum', blockSec:0.25, code:'ARB',  name:'Arbitrum',  short:'Arbitrum', chainId:42161, native:'ETH',  cg:'ethereum',    logo:'/img/chains/arbitrum.png', color:'#4aa3ff', main:false, live:true,
     rpc:'https://arbitrum-one-rpc.publicnode.com',  explorer:'https://arbiscan.io',      lzEid:30110, poolManager:'0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32', launchGas:8700000, v2:{factory:'0x44D016b20a0c8f0A3791B3Ea10Ff09af0eCE1DC2', hook:'0xf465A98680ba72ABEc84e779b3694Ee37638E8CC', router:'0xE4767a75518E14D15F34DcE4155CC4256Ff3D0f9'}},
    {key:'hyper', blockSec:1,    code:'HYPE', name:'HyperEVM',  short:'Hyper',    chainId:999,   native:'HYPE', cg:'hyperliquid', logo:'/img/chains/hyper.png',    color:'#97fce4', main:false, live:true,
     rpc:'https://rpc.hypurrscan.io',               explorer:'https://hyperevmscan.io',  lzEid:30367, poolManager:'0x12D4Fd9C5DeDd00ab8a0bCe2CF0167bbf94b6B1F', launchGas:8700000, v2:{factory:'0x44D016b20a0c8f0A3791B3Ea10Ff09af0eCE1DC2', hook:'0x24Aa9571B592f47fee0e64A2182cE082f6aAE8Cc', router:'0xE4767a75518E14D15F34DcE4155CC4256Ff3D0f9'}},
    {key:'monad', blockSec:0.4,    code:'MON',  name:'Monad',     short:'Monad',    chainId:143,   native:'MON',  cg:'monad',       logo:'/img/chains/monad.png',    color:'#836ef9', main:false, live:true,
     rpc:'https://rpc.monad.xyz',                    explorer:'https://monadscan.com',    lzEid:30390, poolManager:'0x188d586Ddcf52439676Ca21A244753fA19F9Ea8e', launchGas:8700000, v2:{factory:'0x44D016b20a0c8f0A3791B3Ea10Ff09af0eCE1DC2', hook:'0x3fe54e87AF8b2747A2513A5B992a4FAecB6668CC', router:'0xE4767a75518E14D15F34DcE4155CC4256Ff3D0f9'}},
    {key:'megaeth', blockSec:1,  code:'MEGA', name:'MegaETH',   short:'MegaETH',  chainId:4326,  native:'ETH',  cg:'ethereum',    logo:'/img/chains/megaeth.png',  color:'#ff7aa2', main:false, live:true,
     rpc:'https://mainnet.megaeth.com/rpc',          explorer:'https://mega.etherscan.io', lzEid:30398, poolManager:'0xaCB7e78fa05D562e0A5D3089ec896D57D057d38E', launchGas:8700000, v2:{factory:'0x44D016b20a0c8f0A3791B3Ea10Ff09af0eCE1DC2', hook:'0x8b1F580e4150Ab7B67502C94c5169A8b810968cc', router:'0xE4767a75518E14D15F34DcE4155CC4256Ff3D0f9'}},
    {key:'unichain', blockSec:1, code:'UNI',  name:'Unichain',  short:'Unichain', chainId:130,   native:'ETH',  cg:'ethereum',    logo:'/img/chains/unichain.png', color:'#f50db4', main:false, live:true,
     rpc:'https://unichain-rpc.publicnode.com',       explorer:'https://uniscan.xyz',      lzEid:30320, poolManager:'0x1F98400000000000000000000000000000000004', launchGas:8700000, v2:{factory:'0x44D016b20a0c8f0A3791B3Ea10Ff09af0eCE1DC2', hook:'0xb322E409832CbD4B668dd12d6BCa33F08bD0E8Cc', router:'0xE4767a75518E14D15F34DcE4155CC4256Ff3D0f9'}},
    {key:'ink', blockSec:1, code:'INK', name:'Ink', short:'Ink', chainId:57073, native:'ETH', cg:'ethereum', logo:'/img/chains/ink.png', color:'#7132f5', main:false, live:true,
     rpc:'https://rpc-gel.inkonchain.com', explorer:'https://explorer.inkonchain.com', lzEid:30339, poolManager:'0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32', launchGas:8700000, v2:{factory:'0x183625c93080365556178346880D028B79036bAB', hook:'0xf6c3cd41a659d130242f873fc26175b0C12968cc', router:'0xe5D28aFa5402fcf37cc5FF0D42bD1EF522F4133b'}},
    /* Solana: launched by Equo as one of a coin's chains (never the creator's own), a Meteora DAMM v2 pool against
       SOL, bridged by the coin's LayerZero OFT. sol.program: Equo's Solana leg program. Trades sign with a Solana
       wallet (solleg.js). */
    {key:'sol', evm:false,           code:'SOL',  name:'Solana',    short:'Solana',   native:'SOL',  cg:'solana',      logo:'/img/chains/sol.png',      color:'#9945ff', main:false, live:true,
     explorer:'https://solscan.io', lzEid:30168, sol:{program:'8tQmVEDRd4gBXP2brdgKxtmzXbTD3y8uEbY1erS1UFKq', oft:'RuyLPEWoYG2b6mGb6nvKotoNhW2F9KdhrjRghaRdGkz'}}
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
  // test coins (ETEST, ESITE, ELOGO): every chain's address, hidden from the lists
  hiddenCoins: ['0x023fcdfa79f4eeb35beab5e75746985a5760ede9','0x036fb13f5ee22492f43bda85dabfa319faaa94e9','0x0ca6009a2d068f78891cfe681fe3eacd36dbbde9','0x0cf5669f118c847da7a37e54cf89a2307c8a61e9',
    '0x04400a41970d099535f7b17cf9630d2c3a9bebe9','0x05fb608fb7b553b7400e633017e164f630a906e9','0x0662f2a383428a75a31389c689ecce24de5182e9','0x0e6d596231673b20b3c6ebe5bfa7d852e8d608e9',
    '0x01b8e27520085d7fdd80c7ae52813864110573e9','0x04a5586c3944266e737b5038dd94d9ef8faed8e9',
    '0x096dc21f07d3acf8bdfd5a99b88b0ddab9e4f2e9','3mlh3qvx8tagd8phperinngjaz4ul2wdlso5a2aroxmn']
};
