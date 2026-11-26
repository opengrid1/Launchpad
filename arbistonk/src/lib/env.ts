import { defineChain } from "viem";

/** Arbitrum One stockpad (Arbistonk): coins on Uniswap V4 paired with ETH or Reality tokenized stocks. */
// Keyed endpoint (VITE_ALCHEMY_KEY at build time) goes first for every read;
// the public endpoints stay as fallbacks.
const alchemy = import.meta.env.VITE_ALCHEMY_KEY ? [`https://arb-mainnet.g.alchemy.com/v2/${String(import.meta.env.VITE_ALCHEMY_KEY)}`] : [];

export const env = {
  chainId: 42161,
  chainName: "Arbitrum",
  nativeSymbol: "ETH",
  // VITE_RPC_OVERRIDE points every read at one endpoint (local relay in dev/CI).
  rpcUrls: import.meta.env.VITE_RPC_OVERRIDE ? [String(import.meta.env.VITE_RPC_OVERRIDE)] : [
    ...alchemy,
    "https://arb1.arbitrum.io/rpc",
    "https://arbitrum-one-rpc.publicnode.com",
    "https://arbitrum.drpc.org",
    "https://1rpc.io/arb",
  ],
  // Log scans (trades, launches) need wide eth_getLogs ranges; these endpoints serve them.
  logRpcUrls: import.meta.env.VITE_LOG_RPC ? [String(import.meta.env.VITE_LOG_RPC)] : import.meta.env.VITE_RPC_OVERRIDE ? [String(import.meta.env.VITE_RPC_OVERRIDE)] : [
    ...alchemy,
    "https://arbitrum.drpc.org",
    "https://arbitrum-one-rpc.publicnode.com",
    "https://arb1.arbitrum.io/rpc",
  ],
  explorerUrl: "https://arbiscan.io",
  walletConnectProjectId: "e1bda672d5deb56579fe084dddfb9174",
  /** Factory deploy block, the lower bound for log scans. */
  startBlock: BigInt(import.meta.env.VITE_START_BLOCK ?? "0"),
  dexscreenerChain: "arbitrum",
  secondsPerBlock: 0.25,
};

const addr = (key: string, fallback: string) => String(import.meta.env[key] ?? fallback) as `0x${string}`;

/** Deployed contracts on Arbitrum One (VITE_* overrides point a build at a fork). */
export const ADDRESSES = {
  factory: addr("VITE_FACTORY", "0x0000000000000000000000000000000000000000"),
  hook: addr("VITE_HOOK", "0x0000000000000000000000000000000000000000"),
  router: addr("VITE_ROUTER", "0x0000000000000000000000000000000000000000"),
  poolManager: addr("VITE_POOL_MANAGER", "0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32"),
  stateView: addr("VITE_STATE_VIEW", "0x76Fd297e2D437cd7f76d50F01AfE6160f86e9990"),
  weth: addr("VITE_WETH", "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"),
  ethUsdFeed: addr("VITE_ETH_USD_FEED", "0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612"),
};

/** Preview build with sample coins (VITE_DEMO=1): reads come from src/lib/demo.ts, writes are refused. */
export const DEMO = !!import.meta.env.VITE_DEMO;
export const DEPLOYED = DEMO || ADDRESSES.factory !== "0x0000000000000000000000000000000000000000";

export const chain = defineChain({
  id: env.chainId,
  name: env.chainName,
  nativeCurrency: { name: "Ether", symbol: env.nativeSymbol, decimals: 18 },
  rpcUrls: { default: { http: [env.rpcUrls[0]] } },
  blockExplorers: { default: { name: "Arbiscan", url: env.explorerUrl } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
});

export const BRAND = {
  name: "ARBISTONK",
  tagline: "Coins paired with real stocks, on Arbitrum.",
  url: "https://www.arbistonk.fun",
  x: "https://x.com/arbistonk",
  description: "Launch a coin on Arbitrum paired with ETH or a tokenized stock. Trade it in plain ETH. Every swap pays the creator, the holders and the platform, no harvest needed.",
};

/** Fee model as deployed: 4% of the pair side on every swap, split creator / holders / platform. */
export const FEES = { taxPct: 4, creatorPct: 50, holderPct: 30, platformPct: 20 };

/** Official coins, always listed first on the feed. */
export const PINNED_TOKENS: string[] = [];
export const isPinned = (address: string) => PINNED_TOKENS.includes(address.toLowerCase());

/** Coins kept off the public feed (tests). Pages still open by URL. */
export const HIDDEN_TOKENS = new Set<string>([]);
export const isHidden = (address: string) => HIDDEN_TOKENS.has(address.toLowerCase());
