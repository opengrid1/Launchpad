import { defineChain } from "viem";

/** Alicorn: coins on Uniswap V4 paired with ETH, any approved token, or a tokenized stock; holders paid on every trade. */
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
  startBlock: BigInt(import.meta.env.VITE_START_BLOCK ?? "26046985"),
  dexscreenerChain: "ethereum",
  secondsPerBlock: 12,
};

const addr = (key: string, fallback: string) => String(import.meta.env[key] ?? fallback) as `0x${string}`;

/** Deployed contracts on Ethereum mainnet (VITE_* overrides point a build at a fork). */
export const ADDRESSES = {
  factory: addr("VITE_FACTORY", "0x98A59A3B4776b4c4E44d57f19A691944D01e4aD9"),
  /** Pair-asset registry: curated pairs plus any token that registers itself from its Uniswap V3 pool. */
  pairs: addr("VITE_PAIRS", "0x896b35f89B5e657fafb96A6a6cDdA65594437F59"),
  hook: addr("VITE_HOOK", "0x8593D5F1Fa2a074A257EDaCb6DD1cDF51d96C0cC"),
  router: addr("VITE_ROUTER", "0x41437Ee59Cf1b1463dff060625dA4A9Bed2961aD"),
  poolManager: addr("VITE_POOL_MANAGER", "0x000000000004444c5dc75cB358380D2e3dE08A90"),
  stateView: addr("VITE_STATE_VIEW", "0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227"),
  weth: addr("VITE_WETH", "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"),
  v3Factory: addr("VITE_V3_FACTORY", "0x1F98431c8aD98523631AE4a59f267346ea31F984"),
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
  name: "Alicorn",
  tagline: "Pair with anything. Get paid to hold.",
  url: "https://www.alicorn.fun",
  x: "https://x.com/alicorn_fun",
  description: "Launch a coin on Ethereum paired with ETH, UNI, LINK, PEPE, a tokenized stock, or any ERC-20 with a Uniswap pool. Every trade pays 4%: half to the creator, 30% to holders in the pair asset, 20% to the platform. No harvest, no lockups.",
};

/** Fee model as deployed: 4% of the pair side on every swap, split creator / holders / platform. */
export const FEES = { taxPct: 4, creatorPct: 50, holderPct: 30, platformPct: 20 };

/** Official coins, always listed first on the feed. */
export const PINNED_TOKENS: string[] = ["0x46371c83b92d941eaa43855bc9684e5bcbf15c99"];
export const isPinned = (address: string) => PINNED_TOKENS.includes(address.toLowerCase());

/** Coins kept off the public feed (tests). Pages still open by URL. */
export const HIDDEN_TOKENS = new Set<string>(["0x68a026cc122ffc309b3b37c6e69eb21d82d9bb6b"]);
export const isHidden = (address: string) => HIDDEN_TOKENS.has(address.toLowerCase());
