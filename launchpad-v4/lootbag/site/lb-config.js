/* Lootbag deployment config, read by the admin page (and by the live site once it reads the chain).
   The contract addresses stay empty until Lootbag is deployed: copy them from deployments/lootbag-base.json.
   While they are empty the admin page is a preview and sends nothing. */
window.LB_CFG = {
  chainId: 8453,
  chainName: 'Base',
  rpc: 'https://mainnet.base.org',
  explorer: 'https://basescan.org',
  // the wallet that owns the contracts and runs the rounds by hand
  owner: '0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b',
  // Reown (WalletConnect) project id: public, it only identifies the site to Reown. The site's domain must be on
  // the project's allowlist in the Reown dashboard, or mobile wallets will refuse the connection.
  walletConnect: { projectId: 'e1bda672d5deb56579fe084dddfb9174' },
  startBlock: 0,
  contracts: { factory: '', hook: '', payout: '', swapper: '', bags: '', airdrop: '' },
  multicall: '0xcA11bde05977b3631167028862bE2a173976CA11',
  tokens: {
    VVV: ['0xacfE6019Ed1A7Dc6f7B508C02d1b04ec88cC21bf', 18],
    WETH: ['0x4200000000000000000000000000000000000006', 18],
    USDC: ['0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 6],
  },
};
