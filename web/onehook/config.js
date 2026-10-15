/* OneHook site configuration (internal object name kept as INKY so the shared JS needs no rename).
   live: read tokens, trades and prices from the Ethereum contracts (chain.js); prelaunch: preview only, no chain reads.
   reownProjectId: public project id from cloud.reown.com; empty keeps the demo wallet. */
window.INKY = {
  live: false, prelaunch: true,
  reownProjectId: '5b1ae833abd22d348cbf5d53cf58b3b2',
  chainId: 1, rpc: 'https://ethereum-rpc.publicnode.com', logsRpc: 'https://ethereum-rpc.publicnode.com', rpcs: ['https://eth.llamarpc.com', 'https://rpc.ankr.com/eth', 'https://ethereum.publicnode.com'], explorer: 'https://etherscan.io',
  deployBlock: 0,
  weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', usdg: '',
  contracts: {"factory": "", "hook": "", "router": "", "tokenDeployer": "", "poolManager": "0x000000000004444c5dc75cB358380D2e3dE08A90"},
  stocks: [],
  admin: '0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b'
};
