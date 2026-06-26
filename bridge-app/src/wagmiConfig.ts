import { createConfig, http } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import type { Chain } from 'viem'

export const arcMainnet: Chain = {
  id: 5042,
  name: 'ARC Mainnet',
  nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 6 },
  rpcUrls: {
    default: { http: ['https://5042.rpc.thirdweb.com/'] },
    public:  { http: ['https://5042.rpc.thirdweb.com/'] },
  },
  blockExplorers: {
    default: { name: 'ARC Explorer', url: 'https://explorer.arc.io' },
  },
}

export const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as `0x${string}`

export { mainnet }

export const wagmiConfig = createConfig({
  chains: [mainnet, arcMainnet],
  transports: {
    [mainnet.id]: http(),
    [arcMainnet.id]: http('https://5042.rpc.thirdweb.com/'),
  },
})
