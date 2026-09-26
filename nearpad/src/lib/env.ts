/** Network and contract configuration. VITE_* overrides point a build at a
 *  testnet factory or a local relay. */
const network = (import.meta.env.VITE_NEAR_NETWORK as "mainnet" | "testnet" | undefined) ?? "mainnet";

export const env = {
  network,
  /** The factory. Mainnet lives at chipfi.near; an empty override means sample data. */
  factory: String(import.meta.env.VITE_FACTORY ?? (network === "mainnet" ? "chipfi.near" : "")),
  rpcUrls: import.meta.env.VITE_RPC_OVERRIDE
    ? [String(import.meta.env.VITE_RPC_OVERRIDE)]
    : network === "mainnet"
      ? ["https://free.rpc.fastnear.com", "https://rpc.mainnet.near.org", "https://near.lava.build"]
      : ["https://test.rpc.fastnear.com", "https://rpc.testnet.near.org"],
  explorerUrl: network === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io",
  /** Poll interval for live data, ms. */
  pollMs: 8_000,
};

export const DEMO = !!import.meta.env.VITE_DEMO;
export const DEPLOYED = DEMO || env.factory !== "";

export const BRAND = {
  name: "Chipfi",
  tagline: "Launch a coin on NEAR, paired with NEAR or a stock. Holders get paid on every trade.",
  url: "https://www.chipfi.fun",
  x: "https://x.com/chipfi_fun",
};

/** Numbers fixed in the contracts. */
export const RULES = {
  supply: 1_000_000_000,
  curveSupply: 750_000_000,
  poolSupply: 250_000_000,
  platformPct: 20,
  poolFeePct: 1,
  minTaxPct: 1,
  maxTaxPct: 10,
};

/** The exchange coins graduate to. */
export const RHEA = {
  dex: "v2.ref-finance.near",
  wnear: "wrap.near",
  url: "https://dex.rhea.finance",
  swap: (tokenIn: string, tokenOut: string) => `https://dex.rhea.finance/#${tokenIn}|${tokenOut}`,
};

/** The official coin, shown first. */
export const PINNED: string[] = ["c1.chipfi.near"];
export const HIDDEN = new Set<string>([]);
