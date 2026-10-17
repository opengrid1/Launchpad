import { defineChain } from "viem";

/** Ethereum mainnet stockpad: coins on Uniswap V4 paired with ETH or Ondo stocks. */
// Keyed endpoint (VITE_ALCHEMY_KEY at build time) goes first for every read;
// the public endpoints stay as fallbacks.
const alchemy = import.meta.env.VITE_ALCHEMY_KEY ? [`https://eth-mainnet.g.alchemy.com/v2/${String(import.meta.env.VITE_ALCHEMY_KEY)}`] : [];

export const env = {
  chainId: 1,
  chainName: "Ethereum",
  nativeSymbol: "ETH",
  // VITE_RPC_OVERRIDE points every read at one endpoint (local relay in dev/CI).
  rpcUrls: import.meta.env.VITE_RPC_OVERRIDE ? [String(import.meta.env.VITE_RPC_OVERRIDE)] : [
    ...alchemy,
    "https://ethereum-rpc.publicnode.com",
    "https://eth.llamarpc.com",
    "https://rpc.ankr.com/eth",
    "https://1rpc.io/eth",
  ],
  // Log scans (trades, launches) need wide eth_getLogs ranges, which the free
  // public RPCs above refuse; these endpoints serve them.
  logRpcUrls: import.meta.env.VITE_LOG_RPC ? [String(import.meta.env.VITE_LOG_RPC)] : import.meta.env.VITE_RPC_OVERRIDE ? [String(import.meta.env.VITE_RPC_OVERRIDE)] : [
    ...alchemy,
    "https://gateway.tenderly.co/public/mainnet",
    "https://eth.drpc.org",
  ],
  explorerUrl: "https://etherscan.io",
  walletConnectProjectId: "e1bda672d5deb56579fe084dddfb9174",
  /** Factory deploy block, the lower bound for log scans. */
  startBlock: BigInt(import.meta.env.VITE_START_BLOCK ?? "25915149"),
  dexscreenerChain: "ethereum",
  secondsPerBlock: 12,
};

const addr = (key: string, fallback: string) => String(import.meta.env[key] ?? fallback) as `0x${string}`;

/** Deployed contracts on Ethereum mainnet (VITE_* overrides point a build at a fork). */
export const ADDRESSES = {
  factory: addr("VITE_FACTORY", "0x88e21f36829f692FA1fF29fcC8Cc5E61afE77922"),
  hook: addr("VITE_HOOK", "0xAAC2F4D64bD4157c34a19801006D4551342E00cc"),
  router: addr("VITE_ROUTER", "0x0258Edc01480A836600B0d878B9b52f9431dC5F3"),
  poolManager: addr("VITE_POOL_MANAGER", "0x000000000004444c5dc75cB358380D2e3dE08A90"),
  stateView: addr("VITE_STATE_VIEW", "0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227"),
  weth: addr("VITE_WETH", "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"),
  ethUsdFeed: addr("VITE_ETH_USD_FEED", "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419"),
};

/** Preview build with sample coins (VITE_DEMO=1): reads come from src/lib/demo.ts, writes are refused. */
export const DEMO = !!import.meta.env.VITE_DEMO;
export const DEPLOYED = DEMO || ADDRESSES.factory !== "0x0000000000000000000000000000000000000000";

export const chain = defineChain({
  id: env.chainId,
  name: env.chainName,
  nativeCurrency: { name: "Ether", symbol: env.nativeSymbol, decimals: 18 },
  rpcUrls: { default: { http: [env.rpcUrls[0]] } },
  blockExplorers: { default: { name: "Etherscan", url: env.explorerUrl } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
});

export const BRAND = {
  name: "STONKREUM",
  tagline: "Coins paired with real stocks.",
  url: "https://www.stonkreum.fun",
  x: "https://x.com/stonkreum",
  description: "Launch a coin on Ethereum paired with ETH or any of 184 tokenized stocks. Trade it in plain ETH. Every swap pays the creator, the holders and the platform, no harvest needed.",
};

/** Fee model as deployed: 4% of the pair side on every swap, split creator / holders / platform. */
export const FEES = { taxPct: 4, creatorPct: 50, holderPct: 30, platformPct: 20 };

/** Official coins, always listed first on the feed. */
export const PINNED_TOKENS = ["0x89587d36065cb81b49b783bd3cd3c210c4ccd210"];
export const isPinned = (address: string) => PINNED_TOKENS.includes(address.toLowerCase());

/** Coins kept off the public feed (tests). Pages still open by URL. */
export const HIDDEN_TOKENS = new Set<string>([]);
export const isHidden = (address: string) => HIDDEN_TOKENS.has(address.toLowerCase());
