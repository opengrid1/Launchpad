import { createConfig, http } from 'wagmi'
import { mainnet, robinhoodL2 } from './chains'

export const wagmiConfig = createConfig({
  chains: [mainnet, robinhoodL2],
  transports: {
    [mainnet.id]: http(),
    [robinhoodL2.id]: http('https://rpc.robinhood.com'),
  },
})
