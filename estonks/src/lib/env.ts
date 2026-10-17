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
  startBlock: BigInt(import.meta.env.VITE_START_BLOCK ?? "26087264"),
  dexscreenerChain: "ethereum",
  secondsPerBlock: 12,
};

const addr = (key: string, fallback: string) => String(import.meta.env[key] ?? fallback) as `0x${string}`;

/** Estonks v2 on Ethereum mainnet (contracts/deployments/ethereum-estonks-v2.json). */
export const ADDRESSES = {
  factory: addr("VITE_FACTORY", "0x462cC9885188FE0f08597C9Df407f62E86c6D345"),
  hook: addr("VITE_HOOK", "0x97953B0b8f37A0e87b220c8Be1C0C72ADfCcC0cc"),
  router: addr("VITE_ROUTER", "0x467cDd862c36f17b67827Dbba8bdcf4160a8E369"),
  tokenDeployer: addr("VITE_TOKEN_DEPLOYER", "0x3d608288719d372010f21f2fA10a2D546a893F51"),
  poolManager: addr("VITE_POOL_MANAGER", "0x000000000004444c5dc75cB358380D2e3dE08A90"),
  stateView: addr("VITE_STATE_VIEW", "0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227"),
  weth: addr("VITE_WETH", "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"),
  ethUsdFeed: addr("VITE_ETH_USD_FEED", "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419"),
  /** Private vault (contracts/deployments/ethereum-estonks-v2.json: vault). */
  vault: String(import.meta.env.VITE_VAULT ?? "0x0B1a2a9Bbb68C739cC8B03521eda2C9E5E41D4cF") as `0x${string}` | "",
};

/** Private vault deploy block and relay endpoint. */
export const PRIVATE = {
  startBlock: BigInt(import.meta.env.VITE_VAULT_START_BLOCK ?? "26088791"),
  relay: String(import.meta.env.VITE_RELAY_URL ?? "/api/relay"),
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

/** The main token: STONK on v2. */
export const MAIN_TOKEN = String(import.meta.env.VITE_MAIN_TOKEN ?? "0xA567DeB6dAa8120e156966382AF536A8E5638136").toLowerCase();
export const isMain = (address: string) => !!MAIN_TOKEN && address.toLowerCase() === MAIN_TOKEN;

/** Whether a coin shows in the lists: not hidden by the admin. */
export const listed = (t: { hidden: boolean }) => !t.hidden;
