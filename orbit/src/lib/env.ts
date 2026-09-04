import { defineChain } from "viem";

/** HyperEVM launchpad: the ONAIR factory (instant + auction launches on HyperSwap V3). */
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
  /** OnairFactory deploy block. */
  startBlock: 44941000n,
  dexscreenerChain: "hyperliquid",
  /** HyperEVM small blocks land about once a second. */
  secondsPerBlock: 1,
};

const addr = (key: string, fallback: string) => String(import.meta.env[key] ?? fallback) as `0x${string}`;

/** One HyperAuction deployment: factory + auction house + token deployer. */
export interface Deployment {
  name: string;
  factory: `0x${string}`;
  house: `0x${string}`;
  tokenDeployer: `0x${string}`;
  /** Factory deploy block, the lower bound for log scans. */
  startBlock: bigint;
}

/** The v2 stack (stock pairs) is where new coins launch. The v1 stack stays
 *  live: its coins, pools, auctions and fees are read and served as before.
 *  VITE_* overrides point a build at a local stack. */
const ALL: Deployment[] = [
  {
    name: "v2",
    factory: addr("VITE_FACTORY", "0xA56dC806CAf3866D2c831A0455f5a214d7A27F1D"),
    house: addr("VITE_HOUSE", "0x41Dd552c84595A201244913d23E51A4EB4A2c99a"),
    tokenDeployer: addr("VITE_TOKEN_DEPLOYER", "0xCd92A0D7BE5B34019Ca41ddAd29a9F0e9a4E8aeF"),
    startBlock: 44998000n,
  },
  {
    name: "v1",
    factory: "0x469D1F86485720c60e17538cEf44071E4f299ACe",
    house: "0xad1e5800cde9D3A7aabbfD4D1aD7Ef4ce0941c3e",
    tokenDeployer: "0xD175CcE73949CB1Db283f64383D148bcb0B49058",
    startBlock: 44941000n,
  },
];
// A local override (VITE_FACTORY) runs a single stack.
export const DEPLOYMENTS: Deployment[] = import.meta.env.VITE_FACTORY ? ALL.slice(0, 1) : ALL;

export const PRIMARY = DEPLOYMENTS[0];
export const LEGACY = DEPLOYMENTS.slice(1);

/** Addresses the app writes to (new launches, admin settings) plus the shared
 *  HyperSwap router and the native pair. */
export const ADDRESSES = {
  factory: PRIMARY.factory,
  house: PRIMARY.house,
  tokenDeployer: PRIMARY.tokenDeployer,
  swapRouter: addr("VITE_SWAP_ROUTER", "0x6d99e7f6747af2cdbb5164b6dd50e40d4fde1e77"),
  quote: addr("VITE_QUOTE", "0x5555555555555555555555555555555555555555"), // WHYPE
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
  name: "HYPERAUCTION",
  tagline: "Every coin, one fair price.",
  url: "https://www.hyperauction.fun",
  x: "https://x.com/hyperauctionX",
  description: "Coin auctions on HyperEVM. Launch a coin into a four-hour auction where every bidder pays one clearing price, or list it instantly against HYPE or a tokenized stock. Liquidity locked, every trade pays the creator.",
};

/** Fee split on the 1% pool tier, as deployed. */
export const FEES = { creatorPct: 70, platformPct: 30, poolPct: 1 };

/** Test launches kept off the public feed. Their pages still open by URL and
 *  they still show in My bids and Admin. */
export const HIDDEN_TOKENS = new Set([
  "0xe621938e8634521a517a6cad4cfa909fba40be3b", // Test Pattern
  "0x1b3bec0bbf8dd383267cc9c33c82d0870bf10b6e", // Hammer Time
  "0x02a6521d5fcb15f16167c0039f899235c7fd7c14", // Final Lot
  "0x94d4c688f79369308f50b33b8bd253e34c4e9e02", // $AUCTION auction attempt (did not bond, refunds via My bids)
]);
export const isHidden = (address: string) => HIDDEN_TOKENS.has(address.toLowerCase());
