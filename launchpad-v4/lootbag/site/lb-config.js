/* Lootbag deployment config, read by the admin page and the wallet connection (and by the live site once it reads
   the chain). Addresses are the Base mainnet deployment recorded in deployments/lootbag-base.json. */
window.LB_CFG = {
  chainId: 8453,
  chainName: 'Base',
  // Public RPCs, tried in this order. They rate-limit and drop out, so there is more than one.
  rpc: 'https://base-rpc.publicnode.com',
  rpcFallbacks: ['https://mainnet.base.org', 'https://base.drpc.org'],
  explorer: 'https://basescan.org',
  // the wallet that owns the contracts and runs the rounds by hand
  owner: '0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b',
  // Reown (WalletConnect) project id: public, it only identifies the site to Reown. The site's domain must be on
  // the project's allowlist in the Reown dashboard, or mobile wallets will refuse the connection.
  walletConnect: { projectId: 'e1bda672d5deb56579fe084dddfb9174' },
  startBlock: 62517259,
  contracts: {
    factory: '0xe1e57D339C840545Eb38131A0085369F2E08430d',
    hook: '0x84d04ca2A620610d16D8004C89D9aaa73d612AcC',
    payout: '0x27476fDdf3BD05AD06aa3Aa54b4CAf0717ecb1E2',
    swapper: '0x5776229B170713Fc150Cce7Dc860FE8E522534AE',
    bags: '0x7864584917E42628FD335ebec1de13C9484E53fb',
    airdrop: '0xE8A74b2971d691b95Db0B5499DcC8F2e7D7d6D99',
  },
  multicall: '0xcA11bde05977b3631167028862bE2a173976CA11',
  tokens: {
    VVV: ['0xacfE6019Ed1A7Dc6f7B508C02d1b04ec88cC21bf', 18],
    WETH: ['0x4200000000000000000000000000000000000006', 18],
    USDC: ['0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 6],
  },
};
