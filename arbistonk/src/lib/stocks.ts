import { encodeAbiParameters, encodePacked, type Address, type Hex } from "viem";

// Reality Finance rTokens on Arbitrum One: tokenized US stocks backed 1:1
// with custody at Alpaca. Only the ones with a funded Uniswap V3 USDC pool
// are listed, because `route` is the ETH to stock path the router walks:
// WETH to USDC on Uniswap V3 (0.05%), then the stock's own USDC pool (0.05%).
// Prices and liquidity are the pool figures at listing time; the factory's
// on-chain price wins when read. Source: contracts/deployments/arbitrum-stock-quotes.json.
export interface StockRoute {
  kind: "v3" | "v4";
  via: "USDC" | "USDT" | "WETH";
  fee: number;
  tickSpacing?: number;
  hooks?: string;
}
export interface Stock {
  symbol: string;
  ticker: string;
  name: string;
  address: Address;
  /** Snapshot USD price (the factory's on-chain price wins when read). */
  usd: number;
  /** USD in the stock's deepest pool at the last scan (0 = none). */
  liqUsd: number;
  vol24Usd: number;
  route?: StockRoute;
}

export const WETH: Address = "0x82af49447d8a07e3bd95bd0d56f35241523fbab1";
export const USDC: Address = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
export const USDT: Address = "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9";
const STABLE: Record<string, Address> = { USDC, USDT, WETH };
/** WETH/stable Uniswap V3 tier used for the first hop. */
const WETH_STABLE_FEE = 500;

export const STOCKS: Stock[] = [
  { symbol: "rCRCL", ticker: "CRCL", name: "Circle Internet Group", address: "0x861a85a78c371bc0a02675bbe00a4cbc0826b421", usd: 86.23, liqUsd: 101154, vol24Usd: 0, route: { kind: "v3", via: "USDC", fee: 500 } },
  { symbol: "rSPCX", ticker: "SPCX", name: "SpaceX", address: "0x5181b7dd097b42d7787ee78efab86f43d4e12f44", usd: 155.06, liqUsd: 102258, vol24Usd: 0, route: { kind: "v3", via: "USDC", fee: 500 } },
  { symbol: "rHOOD", ticker: "HOOD", name: "Robinhood Markets", address: "0x485cb1ed5662a911eba7f8547eb9e253cf43b8ae", usd: 111.57, liqUsd: 98880, vol24Usd: 0, route: { kind: "v3", via: "USDC", fee: 500 } },
  { symbol: "rAAPL", ticker: "AAPL", name: "Apple", address: "0xaba5e0c80e9f58e391214689fb342049c0d31892", usd: 336.14, liqUsd: 100551, vol24Usd: 0, route: { kind: "v3", via: "USDC", fee: 500 } },
];

export const stockByAddress = (addr?: string): Stock | undefined =>
  addr ? STOCKS.find((s) => s.address === addr.toLowerCase()) : undefined;

const KEY_T = { type: "tuple", components: [{ name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" }] } as const;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const ZERO_KEY = { currency0: ZERO, currency1: ZERO, fee: 0, tickSpacing: 0, hooks: ZERO };

/** The router's encoded route for a pair: abi.encode(bytes v3Path, PoolKey v4Key).
 *  Empty for WETH. Null when the stock has no usable pool (pay in the stock). */
export function routeFor(pair: Address): Hex | null {
  if (pair.toLowerCase() === WETH) return "0x";
  const s = stockByAddress(pair);
  if (!s?.route) return null;
  const via = STABLE[s.route.via];
  if (s.route.kind === "v3") {
    const path = via === WETH
      ? encodePacked(["address", "uint24", "address"], [WETH, s.route.fee, pair])
      : encodePacked(["address", "uint24", "address", "uint24", "address"], [WETH, WETH_STABLE_FEE, via, s.route.fee, pair]);
    return encodeAbiParameters([{ type: "bytes" }, KEY_T], [path, ZERO_KEY]);
  }
  const path = via === WETH ? "0x" : encodePacked(["address", "uint24", "address"], [WETH, WETH_STABLE_FEE, via]);
  const [c0, c1] = [via, pair].map((a) => a.toLowerCase()).sort() as [Address, Address];
  const key = { currency0: c0, currency1: c1, fee: s.route.fee, tickSpacing: s.route.tickSpacing ?? 60, hooks: (s.route.hooks ?? ZERO) as Address };
  return encodeAbiParameters([{ type: "bytes" }, KEY_T], [path, key]);
}

/** True when ETH can be routed into and out of this pair on-chain. */
export const hasEthRoute = (pair: Address) => routeFor(pair) !== null;
