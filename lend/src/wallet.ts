import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { defineChain } from "@reown/appkit/networks";
import { http, type WalletClient } from "viem";
import type { Config } from "wagmi";
import { getChainId, getWalletClient, switchChain } from "wagmi/actions";

import { BRAND, CHAIN, RPC, WC_PROJECT_ID, EXPLORER } from "./config";

const network = defineChain({
  id: CHAIN.id,
  caipNetworkId: `eip155:${CHAIN.id}`,
  chainNamespace: "eip155",
  name: CHAIN.name,
  nativeCurrency: CHAIN.nativeCurrency,
  rpcUrls: { default: { http: [RPC] } },
  blockExplorers: { default: { name: "Blockscout", url: EXPLORER } },
});

const adapter = new WagmiAdapter({
  networks: [network],
  projectId: WC_PROJECT_ID,
  transports: { [CHAIN.id]: http(RPC, { batch: { wait: 16 } }) },
});

export const wagmiConfig = adapter.wagmiConfig as Config;

let modal: Promise<{ open: () => void }> | null = null;

/** Open the wallet modal (injected, WalletConnect, Coinbase), loading its UI on first use. */
export function openWalletModal(): Promise<void> {
  if (!modal) {
    modal = import("@reown/appkit/react").then(({ createAppKit }) =>
      createAppKit({
        adapters: [adapter],
        networks: [network],
        defaultNetwork: network,
        projectId: WC_PROJECT_ID,
        metadata: { name: BRAND.name, description: BRAND.description, url: BRAND.url, icons: [`${BRAND.url}/dividenz-feather.png`] },
        themeVariables: { "--w3m-accent": "#00C805", "--w3m-border-radius-master": "2px" },
        features: { analytics: false, email: false, socials: [] },
      }),
    );
  }
  return modal.then((m) => m.open());
}

/** Wallet client on Robinhood Chain, switching (or adding) the network if needed. */
export async function ensureWallet(): Promise<WalletClient> {
  if (getChainId(wagmiConfig) !== CHAIN.id) await switchChain(wagmiConfig, { chainId: CHAIN.id });
  const wc = await getWalletClient(wagmiConfig, { chainId: CHAIN.id });
  if (!wc) throw new Error("No wallet connected");
  return wc as unknown as WalletClient;
}
