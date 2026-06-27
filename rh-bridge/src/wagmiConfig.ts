import { createAppKit } from '@reown/appkit/react'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { mainnet as ethMainnet, type AppKitNetwork } from '@reown/appkit/networks'

export const rhChain: AppKitNetwork = {
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://4663.rpc.thirdweb.com/'] },
  },
  blockExplorers: {
    default: { name: 'RH Explorer', url: 'https://explorer.robinhood.com' },
  },
  caipNetworkId: 'eip155:4663',
  chainNamespace: 'eip155',
}

export const mainnet = ethMainnet

const projectId = 'e1bda672d5deb56579fe084dddfb9174'

const networks: [AppKitNetwork, ...AppKitNetwork[]] = [ethMainnet, rhChain]

export const wagmiAdapter = new WagmiAdapter({ networks, projectId })

createAppKit({
  adapters: [wagmiAdapter],
  networks,
  projectId,
  metadata: {
    name: 'RH Bridge',
    description: 'Bridge ETH from Ethereum to Robinhood Chain',
    url: 'https://rhbridge.xyz',
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
