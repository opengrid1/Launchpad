import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { defineChain } from "@reown/appkit/networks";
import { http, type WalletClient } from "viem";
import type { Config } from "wagmi";
import { getChainId, getWalletClient, switchChain } from "wagmi/actions";

import { client } from "./client";
import { BRAND, chain, env } from "./env";

const network = defineChain({
  id: chain.id,
  caipNetworkId: `eip155:${chain.id}`,
  chainNamespace: "eip155",
  name: chain.name,
  nativeCurrency: chain.nativeCurrency,
  rpcUrls: { default: { http: [env.rpcUrls[0]] } },
  blockExplorers: { default: { name: "HyperEVMScan", url: env.explorerUrl } },
});

const adapter = new WagmiAdapter({
  networks: [network],
  projectId: env.walletConnectProjectId,
  transports: { [chain.id]: http(env.rpcUrls[0], { batch: { wait: 16 } }) },
});

export const wagmiConfig = adapter.wagmiConfig as Config;

let modal: Promise<{ open: () => void }> | null = null;

/** Open the wallet picker (injected, WalletConnect, Coinbase); its UI loads on first use. */
export function openWalletModal(): Promise<void> {
  if (!modal) {
    modal = import("@reown/appkit/react").then(({ createAppKit }) =>
      createAppKit({
        adapters: [adapter],
        networks: [network],
        defaultNetwork: network,
        projectId: env.walletConnectProjectId,
        metadata: { name: BRAND.name, description: BRAND.description, url: BRAND.url, icons: [`${BRAND.url}/icon.svg`] },
        themeVariables: { "--w3m-accent": "#0071E3", "--w3m-border-radius-master": "3px", "--w3m-font-family": "-apple-system, Geist, system-ui, sans-serif" },
        features: { analytics: false, email: false, socials: [] },
      }),
    );
  }
  return modal.then((m) => m.open());
}

/** Attach the connected wallet to the client on HyperEVM, switching networks if needed. */
export async function ensureWallet(): Promise<WalletClient> {
  if (getChainId(wagmiConfig) !== chain.id) await switchChain(wagmiConfig, { chainId: chain.id });
  const wc = await getWalletClient(wagmiConfig, { chainId: chain.id });
  if (!wc) throw new Error("No wallet connected");
  client.connectWallet(wc as unknown as WalletClient);
  return wc as unknown as WalletClient;
}
