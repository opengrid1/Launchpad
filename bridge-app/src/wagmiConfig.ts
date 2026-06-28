import { createAppKit } from '@reown/appkit/react'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { mainnet as ethMainnet, base as baseMainnet, type AppKitNetwork } from '@reown/appkit/networks'

export const arcMainnet: AppKitNetwork = {
  id: 5042,
  name: 'Arc Network',
  nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 6 },
  rpcUrls: {
    default: { http: ['https://5042.rpc.thirdweb.com/'] },
  },
  blockExplorers: {
    default: { name: 'ARC Explorer', url: 'https://explorer.arc.io' },
  },
  caipNetworkId: 'eip155:5042',
  chainNamespace: 'eip155',
}

export const mainnet = ethMainnet

export const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as `0x${string}`

const projectId = 'e1bda672d5deb56579fe084dddfb9174'

const networks: [AppKitNetwork, ...AppKitNetwork[]] = [ethMainnet, baseMainnet, arcMainnet]

export const wagmiAdapter = new WagmiAdapter({ networks, projectId })

createAppKit({
  adapters: [wagmiAdapter],
  networks,
  projectId,
  metadata: {
    name: 'Arcanebridge',
    description: 'Bridge USDC from Ethereum to Arc Network',
    url: 'https://bridge-app-green.vercel.app',
    icons: [],
  },
  features: {
    analytics: false,
    email: false,
    socials: false,
  },
  themeMode: 'dark',
})

export const wagmiConfig = wagmiAdapter.wagmiConfig
