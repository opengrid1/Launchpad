import { createPublicClient, defineChain, http } from 'viem'

export const hyperevm = defineChain({
  id: 999,
  name: 'HyperEVM',
  nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.hyperliquid.xyz/evm'] } },
  blockExplorers: { default: { name: 'HyperEVMScan', url: 'https://hyperevmscan.io' } },
  contracts: {
    multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' },
  },
})

export const publicClient = createPublicClient({
  chain: hyperevm,
  transport: http(undefined, { batch: true }),
  batch: { multicall: { wait: 16 } },
})

export function explorerTx(hash: string) {
  return `${hyperevm.blockExplorers.default.url}/tx/${hash}`
}

export function explorerAddress(address: string) {
  return `${hyperevm.blockExplorers.default.url}/address/${address}`
}
