import { mainnet } from 'wagmi/chains'
import type { Chain } from 'viem'

export const robinhoodL2: Chain = {
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
  testnet: false,
}

export { mainnet }

export const SUPPORTED_CHAINS = [mainnet, robinhoodL2] as const

export const BRIDGE_TOKENS = [
  {
    symbol: 'ETH',
    name: 'Ether',
    decimals: 18,
    logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
    address: null as null | `0x${string}`,
  },
  {
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    logoURI: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png',
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as `0x${string}`,
  },
  {
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
    logoURI: 'https://assets.coingecko.com/coins/images/325/small/tether.png',
    address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' as `0x${string}`,
  },
]
