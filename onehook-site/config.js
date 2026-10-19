/* OneHook site configuration (internal object name kept as INKY so the shared JS needs no rename).
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
  stocks: [],
  admin: '0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b'
};
