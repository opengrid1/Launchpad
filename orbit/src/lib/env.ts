import { defineChain } from "viem";

/** HyperEVM launchpad: the same factory hyperstock uses, under a new product. */
export const env = {
  chainId: 999,
  chainName: "HyperEVM",
  nativeSymbol: "HYPE",
  // VITE_RPC_OVERRIDE points every read at one endpoint (local relay in dev/CI).
  rpcUrls: import.meta.env.VITE_RPC_OVERRIDE ? [String(import.meta.env.VITE_RPC_OVERRIDE)] : [
    "https://rpc.hyperliquid.xyz/evm",
    "https://hyperliquid.drpc.org",
    "https://rpc.hyperlend.finance",
    "https://hyperliquid-json-rpc.stakely.io",
  ],
  explorerUrl: "https://hyperevmscan.io",
  walletConnectProjectId: "e1bda672d5deb56579fe084dddfb9174",
  startBlock: 44095167n,
  dexscreenerChain: "hyperliquid",
};

export const ADDRESSES = {
  factory: "0x8856a0BAa8bfeB39b93d4846c825Ca615Eaf69E3" as `0x${string}`,
  tokenDeployer: "0x10d9332a0673c7C18b62f59D6C39AbAB4465ebF4" as `0x${string}`,
  swapRouter: "0x6d99e7f6747af2cdbb5164b6dd50e40d4fde1e77" as `0x${string}`,
  quote: "0x5555555555555555555555555555555555555555" as `0x${string}`, // WHYPE
};

export const chain = defineChain({
  id: env.chainId,
  name: env.chainName,
  nativeCurrency: { name: env.nativeSymbol, symbol: env.nativeSymbol, decimals: 18 },
  rpcUrls: { default: { http: [env.rpcUrls[0]] } },
  blockExplorers: { default: { name: "HyperEVMScan", url: env.explorerUrl } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
});

export const BRAND = {
  name: "Orbit",
  tagline: "Launch a coin. Watch it go.",
  url: "https://orbit-hyper.vercel.app",
  description: "Launch a coin on HyperEVM. Fair launch, instant liquidity, creators earn on every trade.",
};
