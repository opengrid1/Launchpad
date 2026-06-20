import { formatUnits, getAddress, zeroAddress, type Address } from "viem";
import { publicClient } from "./chain.js";
import { erc20Abi, factoryAbi, poolAbi } from "./abis.js";
import { ADDRESSES, FEE_TIERS } from "./config.js";

const Q96 = 2n ** 96n;

export interface TokenMeta {
  address: Address;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
}

export async function getTokenMeta(token: Address): Promise<TokenMeta> {
  const [name, symbol, decimals, totalSupply] = await Promise.all([
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: "name" }),
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: "totalSupply" }),
  ]);
  return { address: getAddress(token), name, symbol, decimals, totalSupply };
}

export function balanceOf(token: Address, owner: Address) {
  return publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
}

export interface PoolInfo {
  pool: Address;
  fee: number;
  token0: Address;
  token1: Address;
  sqrtPriceX96: bigint;
  liquidity: bigint;
  /** Price of 1 whole `token` expressed in whole WETH/ETH. */
  priceInEth: number;
}

/**
 * Locate the most-liquid Uniswap-V3 WETH pool for `token` and read its price.
 * Probes the standard fee tiers and picks the pool with the largest liquidity.
 */
export async function findPool(token: Address, decimals: number): Promise<PoolInfo | null> {
  const weth = ADDRESSES.weth as Address;
  const candidates = await Promise.all(
    FEE_TIERS.map(async (fee) => {
      const pool = (await publicClient.readContract({
        address: ADDRESSES.factory as Address,
        abi: factoryAbi,
        functionName: "getPool",
        args: [token, weth, fee],
      })) as Address;
      if (pool === zeroAddress) return null;
      const [slot0, liquidity, token0] = await Promise.all([
        publicClient.readContract({ address: pool, abi: poolAbi, functionName: "slot0" }),
        publicClient.readContract({ address: pool, abi: poolAbi, functionName: "liquidity" }),
        publicClient.readContract({ address: pool, abi: poolAbi, functionName: "token0" }),
      ]);
      return { pool, fee, slot0, liquidity, token0 } as const;
    }),
  );

  const live = candidates.filter((c): c is NonNullable<typeof c> => c !== null && c.liquidity > 0n);
  if (live.length === 0) return null;
  live.sort((a, b) => (b.liquidity > a.liquidity ? 1 : -1));
  const best = live[0];

  const sqrtPriceX96 = best.slot0[0] as bigint;
  const token0 = getAddress(best.token0);
  const wethIsToken0 = token0 === getAddress(weth);

  // price0in1 = (sqrt/2^96)^2  == token1 per token0, in raw units.
  const ratio = Number(sqrtPriceX96) / Number(Q96);
  const token1PerToken0 = ratio * ratio;
  const wethDecimals = 18;

  // Convert raw ratio to whole-unit price of `token` in ETH.
  let priceInEth: number;
  if (wethIsToken0) {
    // token0 = WETH, token1 = token  -> token1PerToken0 = token per WETH (raw)
    const tokenPerWeth = token1PerToken0 * 10 ** (wethDecimals - decimals);
    priceInEth = tokenPerWeth === 0 ? 0 : 1 / tokenPerWeth;
  } else {
    // token0 = token, token1 = WETH  -> token1PerToken0 = WETH per token (raw)
    priceInEth = token1PerToken0 * 10 ** (decimals - wethDecimals);
  }

  return {
    pool: getAddress(best.pool),
    fee: best.fee,
    token0,
    token1: wethIsToken0 ? token : getAddress(weth),
    sqrtPriceX96,
    liquidity: best.liquidity,
    priceInEth,
  };
}

export function fmt(value: bigint, decimals: number, maxFrac = 6): string {
  const s = formatUnits(value, decimals);
  const [i, f = ""] = s.split(".");
  return f ? `${i}.${f.slice(0, maxFrac)}` : i;
}
