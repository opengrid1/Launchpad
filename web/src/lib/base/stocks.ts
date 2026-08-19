import type { Address } from "viem";

/** A Base tokenized stock usable as a launch pair + holder reward. Only
 *  stocks with real on-chain USDC liquidity are listed, so every reward is
 *  actually tradeable. `usd` is a snapshot price for sizing the launch. */
export interface BaseStock {
  symbol: string;
  name: string;
  address: Address;
  usd: number;
  /** Uniswap V3 fee tier of the stock's USDC pool (for the buy/sell route). */
  fee: number;
}

/** Base stocks with verified USDC liquidity, deepest first. */
export const BASE_STOCKS: BaseStock[] = [
  { symbol: "GOOGLc", name: "Alphabet (Google)", address: "0xb2000000000000000000002D0BA3164cc74f58B7", usd: 342.53, fee: 3000 },
  { symbol: "METAc", name: "Meta Platforms", address: "0xb2000000000000000000008bC8786B856E61707C", usd: 626.15, fee: 3000 },
  { symbol: "AAPLc", name: "Apple", address: "0xb200000000000000000000C2e324d24d7eEcd1fb", usd: 308.83, fee: 3000 },
  { symbol: "NVDAc", name: "NVIDIA", address: "0xb20000000000000000000078ee7ce2fE4908108C", usd: 251.60, fee: 3000 },
  { symbol: "wtCOIN", name: "Coinbase (ST0x)", address: "0x5cDa0E1CA4ce2af96315f7F8963C85399c172204", usd: 145.17, fee: 3000 },
  { symbol: "wtMSTR", name: "MicroStrategy (ST0x)", address: "0xFF05E1bD696900dc6A52CA35Ca61Bb1024eDa8e2", usd: 93.0, fee: 3000 },
  { symbol: "wtNVDA", name: "NVIDIA (ST0x)", address: "0xFb5B41acdbA20a3230F84BE995173CFb98b8D6E7", usd: 220.16, fee: 3000 },
];

export const baseStockOf = (addr?: string): BaseStock | undefined =>
  addr ? BASE_STOCKS.find((s) => s.address.toLowerCase() === addr.toLowerCase()) : undefined;
