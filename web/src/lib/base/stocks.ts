import type { Address } from "viem";

/** A Base tokenized stock usable as a launch pair + holder reward. Only stocks
 *  with deep, verified on-chain liquidity are listed, so every reward is
 *  actually tradeable and the ETH<->stock leg routes cheaply. Liquidity lives
 *  on Aerodrome Slipstream (concentrated), quoted in USDC. `usd` is a snapshot
 *  price for sizing the launch and the board's market cap. */
export interface BaseStock {
  symbol: string;
  name: string;
  address: Address;
  usd: number;
  /** Aerodrome Slipstream tickSpacing of the stock's USDC pool (for the route). */
  usdcTickSpacing: number;
}

/** Base stocks with deep Aerodrome Slipstream USDC liquidity (~$230k+ each),
 *  deepest first. Others (the thin "wt"/wrapped variants) are omitted until
 *  their liquidity is deep enough to trade cleanly. */
export const BASE_STOCKS: BaseStock[] = [
  { symbol: "METAc", name: "Meta Platforms", address: "0xb2000000000000000000008bC8786B856E61707C", usd: 546.2, usdcTickSpacing: 10 },
  { symbol: "GOOGLc", name: "Alphabet (Google)", address: "0xb2000000000000000000002D0BA3164cc74f58B7", usd: 342.39, usdcTickSpacing: 10 },
  { symbol: "AAPLc", name: "Apple", address: "0xb200000000000000000000C2e324d24d7eEcd1fb", usd: 309.23, usdcTickSpacing: 10 },
  { symbol: "NVDAc", name: "NVIDIA", address: "0xb20000000000000000000078ee7ce2fE4908108C", usd: 220.87, usdcTickSpacing: 10 },
];

export const baseStockOf = (addr?: string): BaseStock | undefined =>
  addr ? BASE_STOCKS.find((s) => s.address.toLowerCase() === addr.toLowerCase()) : undefined;
