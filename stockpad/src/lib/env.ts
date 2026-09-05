import { defineChain } from "viem";

/** Ethereum mainnet stockpad: coins on Uniswap V4 paired with ETH or Ondo stocks. */
export const env = {
  chainId: 1,
  chainName: "Ethereum",
  nativeSymbol: "ETH",
  // VITE_RPC_OVERRIDE points every read at one endpoint (local relay in dev/CI).
  rpcUrls: import.meta.env.VITE_RPC_OVERRIDE ? [String(import.meta.env.VITE_RPC_OVERRIDE)] : [
    "https://ethereum-rpc.publicnode.com",
    "https://eth.llamarpc.com",
    "https://rpc.ankr.com/eth",
    "https://1rpc.io/eth",
  ],
  explorerUrl: "https://etherscan.io",
  walletConnectProjectId: "e1bda672d5deb56579fe084dddfb9174",
  /** Factory deploy block, the lower bound for log scans. */
  startBlock: BigInt(import.meta.env.VITE_START_BLOCK ?? "25908000"),
  dexscreenerChain: "ethereum",
  secondsPerBlock: 12,
};

const addr = (key: string, fallback: string) => String(import.meta.env[key] ?? fallback) as `0x${string}`;

/** Deployed contracts on Ethereum mainnet (VITE_* overrides point a build at a fork). */
export const ADDRESSES = {
  factory: addr("VITE_FACTORY", "0x0000000000000000000000000000000000000000"),
  hook: addr("VITE_HOOK", "0x0000000000000000000000000000000000000000"),
  router: addr("VITE_ROUTER", "0x0000000000000000000000000000000000000000"),
  poolManager: addr("VITE_POOL_MANAGER", "0x000000000004444c5dc75cB358380D2e3dE08A90"),
  stateView: addr("VITE_STATE_VIEW", "0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227"),
  weth: addr("VITE_WETH", "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"),
  ethUsdFeed: addr("VITE_ETH_USD_FEED", "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419"),
};

export const DEPLOYED = ADDRESSES.factory !== "0x0000000000000000000000000000000000000000";

export const chain = defineChain({
  id: env.chainId,
  name: env.chainName,
  nativeCurrency: { name: "Ether", symbol: env.nativeSymbol, decimals: 18 },
  rpcUrls: { default: { http: [env.rpcUrls[0]] } },
  blockExplorers: { default: { name: "Etherscan", url: env.explorerUrl } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
});

export const BRAND = {
  name: "STOCKPAD",
  tagline: "Coins paired with real stocks.",
  url: "https://stockpad.fun",
  x: "https://x.com/stockpad",
  description: "Launch a coin on Ethereum paired with ETH or any of 184 tokenized stocks. Trade it in plain ETH. Every swap pays the creator, the holders and the platform, no harvest needed.",
};

/** Fee model as deployed: 4% of the pair side on every swap, split creator / holders / platform. */
export const FEES = { taxPct: 4, creatorPct: 50, holderPct: 30, platformPct: 20 };

/** Coins kept off the public feed (tests). Pages still open by URL. */
export const HIDDEN_TOKENS = new Set<string>([]);
export const isHidden = (address: string) => HIDDEN_TOKENS.has(address.toLowerCase());
