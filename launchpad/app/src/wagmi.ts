import { createAppKit } from "@reown/appkit/react";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { base } from "@reown/appkit/networks";

// Reown (WalletConnect) project id. This is a public client-side identifier.
export const projectId = "e1bda672d5deb56579fe084dddfb9174";

export const networks = [base];

const wagmiAdapter = new WagmiAdapter({
  networks,
  projectId,
  ssr: false,
});

export const config = wagmiAdapter.wagmiConfig;

createAppKit({
  adapters: [wagmiAdapter],
  networks: [base],
  projectId,
  metadata: {
    name: "Coinworks",
    description: "Launch B20 tokens on Base",
    url: "https://umbra-launchpad.vercel.app",
    icons: ["https://umbra-launchpad.vercel.app/favicon.ico"],
  },
  features: { analytics: false, email: false, socials: [] },
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
