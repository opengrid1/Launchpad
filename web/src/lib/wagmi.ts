import { createAppKit } from "@reown/appkit/react";
import type { AppKitNetwork } from "@reown/appkit/networks";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import type { Config } from "wagmi";
import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";

import { chain, env } from "./env";

const projectId = env.walletConnectProjectId;

/** Reown AppKit modal instance; null when no project id is configured. */
export let appKit: ReturnType<typeof createAppKit> | null = null;

let config: Config;

if (projectId) {
  const networks = [chain as unknown as AppKitNetwork] as [AppKitNetwork, ...AppKitNetwork[]];

  const adapter = new WagmiAdapter({
    networks,
    projectId,
    transports: { [chain.id]: http(env.rpcUrl) },
  });

  appKit = createAppKit({
    adapters: [adapter],
    networks,
    defaultNetwork: networks[0],
    projectId,
    metadata: {
      name: "Safehood",
      description: "Launch tokens on Robinhood Chain. Real Uniswap V3 pools, fees to creators.",
      url: "https://www.safehood.fun",
      icons: ["https://www.safehood.fun/icon.png"],
    },
    themeMode: "light",
    features: {
      analytics: false,
      email: false,
      socials: false,
      swaps: false,
      onramp: false,
    },
    themeVariables: {
      "--w3m-accent": "#111111",
      "--w3m-border-radius-master": "2px",
    },
  });

  config = adapter.wagmiConfig;
} else {
  // Local/dev fallback without a WalletConnect project id: injected only.
  config = createConfig({
    chains: [chain],
    connectors: [injected()],
    transports: { [chain.id]: http(env.rpcUrl) },
  });
}

export const wagmiConfig = config;
