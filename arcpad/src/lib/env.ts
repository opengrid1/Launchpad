import { defineChain } from "viem";

/** Arc mainnet launchpad: coins priced in dollars, paired with the chain's native USDC. */
export const env = {
  chainId: 5042,
  chainName: "Arc",
  nativeSymbol: "USDC",
  // Arc's official RPC. VITE_RPC_OVERRIDE points every read at one endpoint (local relay in dev/CI).
  rpcUrls: import.meta.env.VITE_RPC_OVERRIDE ? [String(import.meta.env.VITE_RPC_OVERRIDE)] : ["https://rpc.mainnet.arc.io"],
  // Log scans (trades, launches) go to the same endpoint unless VITE_LOG_RPC names another;
  // the official RPC takes 5,000-block ranges and keeps about a million blocks of history.
  logRpcUrls: import.meta.env.VITE_LOG_RPC ? [String(import.meta.env.VITE_LOG_RPC)] : import.meta.env.VITE_RPC_OVERRIDE ? [String(import.meta.env.VITE_RPC_OVERRIDE)] : ["https://rpc.mainnet.arc.io"],
  explorerUrl: "https://explorer.arc.io",
  walletConnectProjectId: "e1bda672d5deb56579fe084dddfb9174",
  /** Factory deploy block, the lower bound for log scans. */
  startBlock: BigInt(import.meta.env.VITE_START_BLOCK ?? "21105124"),
  dexscreenerChain: "arc",
  secondsPerBlock: 0.5,
  /** Largest eth_getLogs span the log RPC accepts (the public Arc RPC: 5,000). */
  logChunk: BigInt(import.meta.env.VITE_LOG_CHUNK ?? "5000"),
  /** Blocks of log history the RPC keeps; older ranges are not requested. */
  logRetain: BigInt(import.meta.env.VITE_LOG_RETAIN ?? "1000000"),
};

const addr = (key: string, fallback: string) => String(import.meta.env[key] ?? fallback) as `0x${string}`;

/** Deployed contracts on Arc mainnet (VITE_* overrides point a build at a fork). */
export const ADDRESSES = {
  /** ArcLaunchpadFactory v2 (contracts/deployments/arc-v3-launchpad-v2.json). */
  factory: addr("VITE_FACTORY", "0xE77c6b80cE7C5eDa900c31D9A225F3D918fAfdCf"),
  /** ArcSwapRouter: buys and sells in native USDC. */
  router: addr("VITE_ROUTER", "0x2577144ff1a0A79F895237b84921738B338f67BD"),
  tokenDeployer: addr("VITE_TOKEN_DEPLOYER", "0xb4eD32D72793Abd14ea036E245d9aFbf4860591B"),
  /** DyorSwap's Uniswap V3 factory, where every launch pool lives. */
  v3Factory: addr("VITE_V3_FACTORY", "0xF0Db7b58379503491d857DB50Ac9ECE64C653918"),
  /** Native USDC's ERC-20 interface on Arc (6 decimals; the native balance is 18). */
  weth: addr("VITE_USDC", "0x3600000000000000000000000000000000000000"),
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
  name: "arcx.fun",
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
export const HIDDEN_TOKENS = new Set<string>([
  "0x0f51694d9a981f51401400ac18074711bd7cb67e", // CHECKV3: factory v2 end-to-end check
]);
export const isHidden = (address: string) => HIDDEN_TOKENS.has(address.toLowerCase());
