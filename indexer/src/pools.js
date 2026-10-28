import { AbiCoder, keccak256, Interface, toBeHex } from "ethers";
import { Rpc } from "./rpc.js";

/** What each chain's pool holds right now, read live from the chain: the native (pair) side and the coin side of
 *  the factory's launch position, at the pool's current price. Equo coins are always currency0, so the pair is
 *  currency1. Used for the coin page's combined liquidity and its Pools tab; nothing here is stored. */

const coder = AbiCoder.defaultAbiCoder();
const factoryI = new Interface([
  "function positionOf(address) view returns (tuple(int24 tickLower, int24 tickUpper, uint128 liquidity))",
  // Equo v2: the factory's launch position per coin
  "function positions(address) view returns (int24 tickLower, int24 tickUpper, uint128 liquidity)",
]);
const pmI = new Interface(["function extsload(bytes32) view returns (bytes32)"]);
const POOLS_SLOT = 6n; // Uniswap v4 PoolManager: mapping(PoolId => Pool.State) _pools

const rpcs = new Map();
const rpcFor = (chain) => {
  if (!rpcs.has(chain.key)) rpcs.set(chain.key, new Rpc({ ...chain, minGapMs: 0 }));
  return rpcs.get(chain.key);
};

async function extsload(rpc, pm, slot) {
  return BigInt(await rpc.ethCall(pm, pmI.encodeFunctionData("extsload", [toBeHex(slot, 32)])));
}

/** Amounts in a single position [tickLower, tickUpper] with liquidity L at sqrt price s (all as floats). */
export function positionAmounts(sqrtPriceX96, tickLower, tickUpper, liquidity, coinDecimals = 18) {
  const s = Number(sqrtPriceX96) / 2 ** 96, a = Math.pow(1.0001, tickLower / 2), b = Math.pow(1.0001, tickUpper / 2), L = Number(liquidity);
  const p = Math.min(Math.max(s, a), b);
  // price in whole pair per whole coin (a 9-decimal v2 coin's raw price is pair wei per coin unit)
  return { coins: (L * (1 / p - 1 / b)) / 10 ** coinDecimals, pair: (L * (p - a)) / 1e18, inRange: s >= a && s <= b, priceInPair: (s * s * 10 ** coinDecimals) / 1e18 };
}

/** One chain's pool for `token`: price in the pair token, the pair and coin sides, and their USD values. */
export async function poolOf(chain, token, poolId, pairUsd, gen = 1) {
  const v2 = gen >= 2 && chain.v2;
  const rpc = rpcFor(chain);
  const slot = BigInt(keccak256(coder.encode(["bytes32", "uint256"], [poolId, POOLS_SLOT])));
  const [slot0, pos] = await Promise.all([
    extsload(rpc, chain.poolManager, slot),
    v2
      ? rpc.ethCall(chain.v2.factory, factoryI.encodeFunctionData("positions", [token])).then((r) => factoryI.decodeFunctionResult("positions", r))
      : rpc.ethCall(chain.factory, factoryI.encodeFunctionData("positionOf", [token])).then((r) => factoryI.decodeFunctionResult("positionOf", r)[0]),
  ]);
  const sqrtPriceX96 = slot0 & ((1n << 160n) - 1n);
  if (sqrtPriceX96 === 0n) return { state: "not initialized" };
  const a = positionAmounts(sqrtPriceX96, Number(pos.tickLower), Number(pos.tickUpper), pos.liquidity, v2 ? 9 : 18);
  const pairUsdAmt = pairUsd ? a.pair * pairUsd : null;
  return {
    state: pos.liquidity > 0n ? "live" : "empty",
    priceInPair: a.priceInPair,
    priceUsd: pairUsd ? a.priceInPair * pairUsd : null,
    pairInPool: a.pair,
    coinsInPool: a.coins,
    // the pool's two sides at its own price, as DexScreener-style liquidity
    liquidityUsd: pairUsd ? pairUsdAmt + a.coins * a.priceInPair * pairUsd : null,
    pairUsd: pairUsdAmt,
  };
}
