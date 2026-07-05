import { createAppKit } from '@reown/appkit/react'
import { EthersAdapter } from '@reown/appkit-adapter-ethers'
import { defineChain } from '@reown/appkit/networks'

// Robinhood Chain as an AppKit network.
export const robinhoodChain = defineChain({
  id: 4663,
  caipNetworkId: 'eip155:4663',
  chainNamespace: 'eip155',
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] } },
  blockExplorers: { default: { name: 'Explorer', url: 'https://explorer.mainnet.chain.robinhood.com' } },
})

// WalletConnect / Reown project id (public by design — used client-side).
const projectId = 'e1bda672d5deb56579fe084dddfb9174'

const origin = typeof window !== 'undefined' ? window.location.origin : 'https://app-theta-ashy-62.vercel.app'

// Initialise once at import time.
export const appKit = createAppKit({
  adapters: [new EthersAdapter()],
  networks: [robinhoodChain],
  defaultNetwork: robinhoodChain,
  projectId,
  metadata: {
    name: 'Loxley',
    description: 'A memecoin launchpad on Robinhood Chain — every trade pays the room.',
    url: origin,
    icons: [`${origin}/favicon.svg`],
  },
  features: { analytics: false, email: false, socials: [] },
})
