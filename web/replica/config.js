/* Inkypump site configuration.
   live: read tokens, trades and prices from the Ink contracts (chain.js); prelaunch: hide everything until launch.
   reownProjectId: public project id from cloud.reown.com; empty keeps the demo wallet. */
window.INKY = {
  live: true, prelaunch: false,
  reownProjectId: '5b1ae833abd22d348cbf5d53cf58b3b2',
  chainId: 57073, rpc: 'https://rpc-gel.inkonchain.com', logsRpc: 'https://rpc-qnd.inkonchain.com', rpcs: ['https://ink-rpc.publicnode.com', 'https://ink.gateway.tenderly.co', 'https://ink.drpc.org'], explorer: 'https://explorer.inkonchain.com',
  deployBlock: 57458313,
  weth: '0x4200000000000000000000000000000000000006', usdg: '0xe343167631d89B6Ffc58B88d6b7fB0228795491D',
  contracts: {"factory": "0x0E4C3A944d86243c4463045Ba704645608C865f4", "hook": "0x115f272AC83a77c6214F97e1d34cD3fa7ee540cC", "router": "0xcF3fa6c81a603dee91D4e2597A6b882d2B027F30", "ledger": "0x07B9dDd3AfB7cD1dd9cc19510Acd04F847510d45", "payout": "0x58c710Ba32bA475C6EBeFa379a4B0e43fEd9fD2f", "treasury": "0xd0EAbfb642AF125D8C73c104ff075886BAB33002", "tokenDeployer": "0xCf1DB06786298a7F5c55c5B0ece066b7592fd447", "poolManager": "0x360e68faccca8ca495c1b759fd9eee466db9fb32"},
  stocks: [{"symbol": "NVDAx", "wsymbol": "wNVDAx", "address": "0xa8ddb5Cd96b5222AFe198316E9A57CAA642850D5", "usdgPoolFee": 500}, {"symbol": "SPYx", "wsymbol": "wSPYx", "address": "0xE7E553Cd128F0011777323A0b44a7b96EA1CB540", "usdgPoolFee": 3000}, {"symbol": "QQQx", "wsymbol": "wQQQx", "address": "0x4C1AE29c159838fC1b224636E28E086EB69101f7", "usdgPoolFee": 3000}, {"symbol": "TSLAx", "wsymbol": "wTSLAx", "address": "0xc3FdBe3A68EE5dE461D30415a8165cf9Aefe1171", "usdgPoolFee": 500}, {"symbol": "AAPLx", "wsymbol": "wAAPLx", "address": "0x943BF64D566c32A2Bcd41AC92FB63C111cC9De8f", "usdgPoolFee": 500}, {"symbol": "MSTRx", "wsymbol": "wMSTRx", "address": "0x30987adF0B11dc698438a99BA04ec3a1AB2c7EaB", "usdgPoolFee": 500}, {"symbol": "SPCXx", "wsymbol": "wSPCXx", "address": "0x8e2eeD8b8B5E13Ea7BF38e50d7821d2C57309072", "usdgPoolFee": 500}, {"symbol": "PLTRx", "wsymbol": "wPLTRx", "address": "0x4A2df09536F62341C9f946427D16414C04e21342", "usdgPoolFee": 500}, {"symbol": "NFLXx", "wsymbol": "wNFLXx", "address": "0x7d87fD6A379714194a797c0bBB8B40c30D250856", "usdgPoolFee": 500}],
  admin: '0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b'
};
