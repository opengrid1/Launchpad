import { createConfig, http } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import type { Chain } from 'viem'

export const robinhoodChain: Chain = {
  id: 1996,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.robinhood.com'] },
    public: { http: ['https://rpc.robinhood.com'] },
  },
  blockExplorers: {
    default: { name: 'Robinhood Explorer', url: 'https://explorer.robinhood.com' },
  },
}

export const TOKENS = [
  { symbol: 'ETH',  name: 'Ether',    decimals: 18, address: null as null | `0x${string}` },
  { symbol: 'USDC', name: 'USD Coin', decimals: 6,  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as `0x${string}` },
  { symbol: 'USDT', name: 'Tether',   decimals: 6,  address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' as `0x${string}` },
]

export { mainnet }

export const wagmiConfig = createConfig({
  chains: [mainnet, robinhoodChain],
  transports: {
    [mainnet.id]: http(),
    [robinhoodChain.id]: http('https://rpc.robinhood.com'),
  },
})
