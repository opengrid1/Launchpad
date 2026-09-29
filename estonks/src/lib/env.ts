import { defineChain } from "viem";

/** Estonks: meme coins on Uniswap V4 paired with ETH or Ondo stocks. Every trade pays
 *  the coin's holders; the platform share of every coin pays STONK holders. */
const alchemy = import.meta.env.VITE_ALCHEMY_KEY ? [`https://eth-mainnet.g.alchemy.com/v2/${String(import.meta.env.VITE_ALCHEMY_KEY)}`] : [];

export const env = {
  chainId: 1,
  chainName: "Ethereum",
  nativeSymbol: "ETH",
  rpcUrls: import.meta.env.VITE_RPC_OVERRIDE ? [String(import.meta.env.VITE_RPC_OVERRIDE)] : [
    ...alchemy,
    "https://ethereum-rpc.publicnode.com",
    "https://rpc.ankr.com/eth",
    "https://1rpc.io/eth",
  ],
  // Log scans (trades, launches, balances) need wide eth_getLogs ranges.
  logRpcUrls: import.meta.env.VITE_LOG_RPC ? [String(import.meta.env.VITE_LOG_RPC)] : import.meta.env.VITE_RPC_OVERRIDE ? [String(import.meta.env.VITE_RPC_OVERRIDE)] : [
    ...alchemy,
    "https://gateway.tenderly.co/public/mainnet",
    "https://eth.drpc.org",
  ],
  explorerUrl: "https://etherscan.io",
  walletConnectProjectId: "e1bda672d5deb56579fe084dddfb9174",
  /** Factory deploy block, the lower bound for log scans. */
  startBlock: BigInt(import.meta.env.VITE_START_BLOCK ?? "26081375"),
  dexscreenerChain: "ethereum",
  secondsPerBlock: 12,
};

const addr = (key: string, fallback: string) => String(import.meta.env[key] ?? fallback) as `0x${string}`;

/** Deployed contracts on Ethereum mainnet (contracts/deployments/ethereum-estonks.json). */
export const ADDRESSES = {
  factory: addr("VITE_FACTORY", "0x12f4d0eAEe4ea0cEf7722aF00989D5210417DaD9"),
  hook: addr("VITE_HOOK", "0xeC1004c620Da189aD00B08B7dF772FCE225380cC"),
  router: addr("VITE_ROUTER", "0x706a0661C049A6D1e8b480bFE64627d2333ec532"),
  tokenDeployer: addr("VITE_TOKEN_DEPLOYER", "0xad38C321cBbD734eb12994216E858E827657dcd8"),
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
  name: "Estonks",
  url: "https://estonks.fun",
  x: "https://x.com/estonks_fun",
  telegram: "https://t.me/estonks",
  description: "Meme coins on Ethereum paired with ETH or a real stock. Holders earn on every trade. STONK holders earn on every coin.",
};

/** Fee model as deployed: 2% of the pair side on every swap, split creator / coin holders / platform (STONK holders). */
export const FEES = { taxPct: 2, creatorPct: 35, holderPct: 15, platformPct: 50 };

/** The main token. Set once STONK is launched; empty until then. */
export const MAIN_TOKEN = String(import.meta.env.VITE_MAIN_TOKEN ?? "0x3494c410caa17ad30391DA7F1Eb4554303fbDd99").toLowerCase();
export const isMain = (address: string) => !!MAIN_TOKEN && address.toLowerCase() === MAIN_TOKEN;
