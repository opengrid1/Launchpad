/* OneHook site configuration (internal object name kept as INKY so the shared JS needs no rename).
   live: read tokens, trades and prices from the Ethereum contracts (chain.js); prelaunch: preview only, no chain reads.
   reownProjectId: public project id from cloud.reown.com; empty keeps the demo wallet. */
window.INKY = {
  live: true, prelaunch: false, demo: false,
  reownProjectId: '5b1ae833abd22d348cbf5d53cf58b3b2',
  chainId: 1, rpc: 'https://ethereum-rpc.publicnode.com', logsRpc: 'https://ethereum-rpc.publicnode.com', rpcs: ['https://ethereum-rpc.publicnode.com', 'https://eth.llamarpc.com', 'https://rpc.ankr.com/eth', 'https://eth.drpc.org'], explorer: 'https://etherscan.io',
  deployBlock: 26212902,
  weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', usdg: '',
  contracts: {"factory": "0xBfC05d1aD403f8660743c94b04825aF9d3F16Edf", "hook": "0x6B5115B68AaF0142F62D127Df9a497d2ce37eaEC", "router": "0x536cb7C627bdB297389b8ED54bf7fC1c1A1df15f", "tokenDeployer": "0x03Fc9d323dbdd8f057605d2e1DfB7e07484D9b8B", "poolManager": "0x000000000004444c5dc75cB358380D2e3dE08A90"},
  stocks: [],
  admin: '0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b'
};
