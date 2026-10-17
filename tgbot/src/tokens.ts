/** Any NEP-141 token on NEAR, traded through Rhea's pools. The route comes
 *  from Rhea's smart router, the same service its own site uses; the swap is
 *  one ft_transfer_call into the exchange with that route as the message. */
import { config } from "./config.js";
import { ftRegistered, TGAS, view, type Call } from "./near.js";
import type { User } from "./store.js";

export interface TokenMeta { account: string; name: string; symbol: string; decimals: number; icon?: string | null }

const metaCache = new Map<string, TokenMeta>();

/** Metadata for a token account, or null when the account is not a token. */
export async function tokenMeta(account: string): Promise<TokenMeta | null> {
  const hit = metaCache.get(account);
  if (hit) return hit;
  try {
    const m = await view<{ name: string; symbol: string; decimals: number; icon?: string | null }>(account, "ft_metadata", {});
    if (!m || typeof m.decimals !== "number") return null;
    const t = { account, name: m.name, symbol: m.symbol, decimals: m.decimals, icon: m.icon };
    metaCache.set(account, t);
    return t;
  } catch { return null; }
}

/** A NEAR account id, named or implicit, as typed by a person. */
export const looksLikeAccount = (s: string) => /^[a-z0-9._-]{2,64}$/.test(s) && (s.includes(".") || /^[0-9a-f]{64}$/.test(s));

interface RouterPool { pool_id: number | string; token_in: string; token_out: string; amount_in?: string; min_amount_out: string }
interface RouterRoute { pools: RouterPool[]; amount_in: string; min_amount_out: string }
export interface Route { amountOut: bigint; routes: RouterRoute[] }

/** Best route for `amountIn` of tokenIn into tokenOut, or null with no path.
 *  The router's slippage is a fraction (0.05 = 5%) and it bakes that into
 *  each leg's min_amount_out, so the user's setting goes straight in. */
export async function findRoute(tokenIn: string, tokenOut: string, amountIn: bigint, slippageBps = 500): Promise<Route | null> {
  try {
    const u = `https://smartrouter.ref.finance/findPath?amountIn=${amountIn}&tokenIn=${tokenIn}&tokenOut=${tokenOut}&pathDeep=3&slippage=${(slippageBps / 10000).toFixed(4)}`;
    const r = await fetch(u, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { result_data?: { routes: RouterRoute[]; amount_out: string } };
    const d = j.result_data;
    if (!d?.routes?.length || !d.amount_out || BigInt(d.amount_out) === 0n) return null;
    // Concentrated-liquidity legs have ids like "a|b|fee" and need a different contract; only numbered pools go through the exchange.
    if (d.routes.some((rt) => rt.pools.some((p) => !/^\d+$/.test(String(p.pool_id))))) return null;
    return { amountOut: BigInt(d.amount_out), routes: d.routes };
  } catch { return null; }
}

/** The exchange message for a route: the router's minimum on the last hop of each leg, none in between. */
export function routeMsg(route: Route): string {
  const actions = route.routes.flatMap((rt) => rt.pools.map((p, k) => {
    const last = k === rt.pools.length - 1;
    return { pool_id: Number(p.pool_id), token_in: p.token_in, token_out: p.token_out, ...(k === 0 ? { amount_in: p.amount_in ?? rt.amount_in } : {}), min_amount_out: last ? p.min_amount_out : "0" };
  }));
  return JSON.stringify({ force: 0, actions });
}

const WNEAR_STORAGE = 1250n * 10n ** 18n;
const TOKEN_STORAGE = 125n * 10n ** 20n; // 0.0125 NEAR covers every common token

export interface TokenBuyPlan { steps: Call[][]; tokensOut: bigint }

/** NEAR into any token: wrap, register on the token when needed, swap. */
export async function planTokenBuy(u: User, token: string, nearIn: bigint): Promise<TokenBuyPlan> {
  const route = await findRoute(config.wnear, token, nearIn, u.slippageBps);
  if (!route) throw new Error("No Rhea route from NEAR to this token right now.");
  const [wnearReg, tokReg] = await Promise.all([ftRegistered(config.wnear, u.accountId), ftRegistered(token, u.accountId)]);
  const steps: Call[] = [
    ...(tokReg ? [] : [{ receiverId: token, method: "storage_deposit", args: { account_id: u.accountId, registration_only: true }, deposit: TOKEN_STORAGE, gas: TGAS(30) }]),
    ...(wnearReg ? [] : [{ receiverId: config.wnear, method: "storage_deposit", args: { account_id: u.accountId, registration_only: true }, deposit: WNEAR_STORAGE, gas: TGAS(30) }]),
    { receiverId: config.wnear, method: "near_deposit", args: {}, deposit: nearIn, gas: TGAS(30) },
    { receiverId: config.wnear, method: "ft_transfer_call", args: { receiver_id: config.dex, amount: nearIn.toString(), msg: routeMsg(route) }, deposit: 1n, gas: TGAS(180) },
  ];
  return { steps: [steps], tokensOut: route.amountOut };
}

export interface TokenSellPlan { steps: Call[][]; nearOut: bigint }

/** Any token back into NEAR: swap to wNEAR, then unwrap whatever wNEAR is there. */
export async function planTokenSell(u: User, token: string, amount: bigint): Promise<TokenSellPlan> {
  const route = await findRoute(token, config.wnear, amount, u.slippageBps);
  if (!route) throw new Error("No Rhea route from this token to NEAR right now.");
  const wnearReg = await ftRegistered(config.wnear, u.accountId);
  // Two transactions: the unwrap amount is only known once the swap has landed.
  const steps: Call[][] = [
    [
      ...(wnearReg ? [] : [{ receiverId: config.wnear, method: "storage_deposit", args: { account_id: u.accountId, registration_only: true }, deposit: WNEAR_STORAGE, gas: TGAS(30) }]),
      { receiverId: token, method: "ft_transfer_call", args: { receiver_id: config.dex, amount: amount.toString(), msg: routeMsg(route) }, deposit: 1n, gas: TGAS(180) },
    ],
    [{ receiverId: config.wnear, method: "near_withdraw", args: { amount: "__WNEAR__" }, deposit: 1n, gas: TGAS(30) }],
  ];
  return { steps, nearOut: route.amountOut };
}

/** Price of one whole token in NEAR, from what one NEAR buys. */
export async function tokenPriceNear(t: TokenMeta): Promise<number | null> {
  const r = await findRoute(config.wnear, t.account, 10n ** 24n);
  if (!r || r.amountOut === 0n) return null;
  const perNear = Number(r.amountOut) / 10 ** t.decimals;
  return perNear > 0 ? 1 / perNear : null;
}

export const rheaUrl = (token: string) => `https://dex.rhea.finance/#wrap.near|${token}`;
