import { http, createConfig } from "wagmi";
import { base } from "wagmi/chains";
import { injected } from "wagmi/connectors";

// Base mainnet. Presale contributions are plain ETH transfers to the
// proceeds wallet, so an injected wallet (MetaMask, Coinbase Wallet,
// Rabby, etc.) is all that is needed.
export const config = createConfig({
  chains: [base],
  connectors: [injected()],
  transports: {
    [base.id]: http(),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
