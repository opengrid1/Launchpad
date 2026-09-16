import { defineChain } from "viem";

/** Arc mainnet launchpad: coins priced in dollars, paired with the chain's native USDC. */
export const env = {
  chainId: 5042,
  chainName: "Arc",
  nativeSymbol: "USDC",
  // VITE_RPC_OVERRIDE points every read at one endpoint (local relay in dev/CI).
  rpcUrls: import.meta.env.VITE_RPC_OVERRIDE ? [String(import.meta.env.VITE_RPC_OVERRIDE)] : [
    ...(import.meta.env.VITE_ALCHEMY_KEY ? [`https://arc-mainnet.g.alchemy.com/v2/${String(import.meta.env.VITE_ALCHEMY_KEY)}`] : []),
    "https://rpc.mainnet.arc.io",
  ],
  // Log scans (trades, launches) need wide eth_getLogs ranges; the public Arc
  // RPC caps the range and prunes history, so a keyed endpoint goes first.
  logRpcUrls: import.meta.env.VITE_LOG_RPC ? [String(import.meta.env.VITE_LOG_RPC)] : import.meta.env.VITE_RPC_OVERRIDE ? [String(import.meta.env.VITE_RPC_OVERRIDE)] : [
    ...(import.meta.env.VITE_ALCHEMY_KEY ? [`https://arc-mainnet.g.alchemy.com/v2/${String(import.meta.env.VITE_ALCHEMY_KEY)}`] : []),
    "https://rpc.mainnet.arc.io",
  ],
  explorerUrl: "https://explorer.arc.io",
  walletConnectProjectId: "e1bda672d5deb56579fe084dddfb9174",
  /** Factory deploy block, the lower bound for log scans. */
  startBlock: BigInt(import.meta.env.VITE_START_BLOCK ?? "0"),
  dexscreenerChain: "arc",
  secondsPerBlock: 1,
};

const addr = (key: string, fallback: string) => String(import.meta.env[key] ?? fallback) as `0x${string}`;

/** Deployed contracts on Arc mainnet (VITE_* overrides point a build at a fork). */
export const ADDRESSES = {
  factory: addr("VITE_FACTORY", "0x0000000000000000000000000000000000000000"),
  hook: addr("VITE_HOOK", "0x0000000000000000000000000000000000000000"),
  router: addr("VITE_ROUTER", "0x0000000000000000000000000000000000000000"),
  poolManager: addr("VITE_POOL_MANAGER", "0x0000000000000000000000000000000000000000"),
  stateView: addr("VITE_STATE_VIEW", "0x0000000000000000000000000000000000000000"),
  /** Native USDC's ERC-20 interface on Arc (6 decimals; the native balance is 18). */
  weth: addr("VITE_USDC", "0x3600000000000000000000000000000000000000"),
  ethUsdFeed: addr("VITE_ETH_USD_FEED", "0x0000000000000000000000000000000000000000"),
};

/** Preview build with sample coins (VITE_DEMO=1): reads come from src/lib/demo.ts, writes are refused. */
export const DEMO = !!import.meta.env.VITE_DEMO;
export const DEPLOYED = DEMO || ADDRESSES.factory !== "0x0000000000000000000000000000000000000000";

export const chain = defineChain({
  id: env.chainId,
  name: env.chainName,
  nativeCurrency: { name: "USD Coin", symbol: env.nativeSymbol, decimals: 18 },
  rpcUrls: { default: { http: [env.rpcUrls[0]] } },
  blockExplorers: { default: { name: "Arc Explorer", url: env.explorerUrl } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
});

export const BRAND = {
  name: "ARCX",
  tagline: "Coins priced in dollars.",
  url: "https://www.arcx.fun",
  x: "https://x.com/arcxfun",
  description: "Launch a coin on Arc, Circle's dollar chain. Every coin is paired with USDC, so prices, fees and payouts are in dollars from the first trade. The creator keeps most of every fee.",
};

/** Fee model: the pool's 1% fee tier, split creator / platform. No holder rewards. */
export const FEES = { taxPct: 1, creatorPct: 80, holderPct: 0, platformPct: 20 };

/** Official coins, always listed first on the feed. */
export const PINNED_TOKENS: string[] = [];
export const isPinned = (address: string) => PINNED_TOKENS.includes(address.toLowerCase());

/** Coins kept off the public feed (tests). Pages still open by URL. */
export const HIDDEN_TOKENS = new Set<string>([]);
export const isHidden = (address: string) => HIDDEN_TOKENS.has(address.toLowerCase());
