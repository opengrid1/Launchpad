import { defineChain, type Chain } from "viem";
import type { LaunchpadAddresses } from "@launchpad/sdk";

function req(name: string): string {
  const v = import.meta.env[name];
  if (!v) throw new Error(`Missing ${name}; copy .env.example to .env.local and fill it in`);
  return String(v);
}

export const env = {
  chainId: Number(req("VITE_CHAIN_ID")),
  chainName: String(import.meta.env.VITE_CHAIN_NAME ?? "Robinhood Chain"),
  rpcUrl: req("VITE_RPC_URL"),
  explorerUrl: String(import.meta.env.VITE_EXPLORER_URL ?? ""),
  nativeSymbol: String(import.meta.env.VITE_NATIVE_SYMBOL ?? "ETH"),
  apiUrl: String(import.meta.env.VITE_API_URL ?? "http://localhost:8080"),
  wsUrl: String(import.meta.env.VITE_WS_URL ?? "ws://localhost:8080/ws"),
  walletConnectProjectId: String(import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? ""),
};

export const addresses: LaunchpadAddresses = {
  launchpad: req("VITE_LAUNCHPAD_ADDRESS") as `0x${string}`,
  feeDistributor: req("VITE_FEE_DISTRIBUTOR_ADDRESS") as `0x${string}`,
  treasury: req("VITE_TREASURY_ADDRESS") as `0x${string}`,
  tokenFactory: req("VITE_TOKEN_FACTORY_ADDRESS") as `0x${string}`,
  weth: req("VITE_WETH_ADDRESS") as `0x${string}`,
};

export const chain: Chain = defineChain({
  id: env.chainId,
  name: env.chainName,
  nativeCurrency: { name: env.nativeSymbol, symbol: env.nativeSymbol, decimals: 18 },
  rpcUrls: { default: { http: [env.rpcUrl] } },
  blockExplorers: env.explorerUrl
    ? { default: { name: "Explorer", url: env.explorerUrl } }
    : undefined,
});
