import { AbiCoder, keccak256, Interface, toBeHex, encodeBase58 } from "ethers";
import { Rpc } from "./rpc.js";

/** What each chain's pool holds right now, read live from the chain: the native (pair) side and the coin side of
 *  the factory's launch position, at the pool's current price. Equo coins are always currency0, so the pair is
 *  currency1. Used for the coin page's combined liquidity and its Pools tab; nothing here is stored.
 *  liquidityUsd is the native side only: the money buyers have put in, which is what can be taken out. A pool opens
 *  with coins alone, so counting its coins at its own price (coinsUsd) would show liquidity nobody has added. */

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
    liquidityUsd: pairUsdAmt,
    coinsUsd: pairUsd ? a.coins * a.priceInPair * pairUsd : null,
    pairUsd: pairUsdAmt,
  };
}

// ---- Solana: the coin's Meteora DAMM v2 pool against wrapped SOL
const SOL_RPC = process.env.EQUO_SOL_RPC || process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";
async function solRpc(method, params) {
  const r = await fetch(SOL_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(5000) });
  const j = await r.json();
  if (j.error) throw new Error("solana rpc: " + j.error.message);
  return j.result;
}
const b58 = (bytes) => { let z = 0; while (z < bytes.length && bytes[z] === 0) z++; return "1".repeat(z) + (z < bytes.length ? encodeBase58(bytes.subarray(z)) : ""); };
const le = (b, o, n) => { let v = 0n; for (let i = n - 1; i >= 0; i--) v = (v << 8n) | BigInt(b[o + i]); return v; };

let solUsdAt = 0, solUsdV = null;
/** SOL in USD (CoinGecko, kept for a minute). */
export async function solUsd() {
  if (Date.now() - solUsdAt < 60_000 && solUsdV) return solUsdV;
  try {
    const j = await (await fetch("https://api.coingecko.com/api/v3/simple/price?vs_currencies=usd&ids=solana", { signal: AbortSignal.timeout(4000) })).json();
    if (j.solana && j.solana.usd > 0) { solUsdV = j.solana.usd; solUsdAt = Date.now(); }
  } catch { /* keep the last */ }
  return solUsdV;
}

/** The Solana pool: its price (SOL per coin, both 9 decimals) and the SOL and coins in its two vaults. */
export async function solPoolOf(poolId, pairUsd) {
  const acc = await solRpc("getAccountInfo", [poolId, { encoding: "base64" }]);
  if (!acc || !acc.value) return { state: "not initialized" };
  const d = Buffer.from(acc.value.data[0], "base64");
  // cp-amm Pool: token_a_vault at 232 (the coin), token_b_vault at 264 (wrapped SOL), sqrt_price (Q64.64) at 456
  const vaultA = b58(d.subarray(232, 264)), vaultB = b58(d.subarray(264, 296)), sp = Number(le(d, 456, 16)) / 2 ** 64;
  const vs = await solRpc("getMultipleAccounts", [[vaultA, vaultB], { encoding: "base64" }]);
  const amt = (v) => (v ? Number(le(Buffer.from(v.data[0], "base64"), 64, 8)) / 1e9 : 0);
  const coins = amt(vs.value[0]), pair = amt(vs.value[1]), priceInPair = sp * sp;
  return {
    state: "live",
    priceInPair,
    priceUsd: pairUsd ? priceInPair * pairUsd : null,
    pairInPool: pair,
    coinsInPool: coins,
    liquidityUsd: pairUsd ? pair * pairUsd : null,
    coinsUsd: pairUsd ? coins * priceInPair * pairUsd : null,
    pairUsd: pairUsd ? pair * pairUsd : null,
  };
}
