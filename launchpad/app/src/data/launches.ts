export type Status = "bonding" | "graduated";

export type Launch = {
  id: string;
  name: string;
  symbol: string;
  status: Status;          // bonding = trading on the curve, graduated = on a DEX
  priceEth: number;        // current price per token
  marketCap: number;       // ETH
  liquidity: number;       // ETH held in the curve / pool
  graduateAt: number;      // market cap (ETH) at which it migrates to a DEX
  change24h: number;       // %
  holders: number;
  supply: number;          // total token supply
  createdAgo: string;
  about: string;
  roles: { mint: boolean; burn: boolean; pause: boolean; freeze: boolean };
  links?: { website?: string; x?: string; telegram?: string; discord?: string };
};

// Launches are read from on-chain curve state + the token's B20 / ERC-7572
// metadata. Empty until the contracts are deployed and wired.
export const LAUNCHES: Launch[] = [];

export const fmt = (n: number, dp = 2) =>
  n.toLocaleString("en-US", { maximumFractionDigits: dp });
