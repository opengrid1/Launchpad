/** Chipfi coins: finding them, pricing them, and the calls that trade them
 *  in each phase. Mirrors what the site does, signed by the bot wallet. */
import { config } from "./config.js";
import { ftBalance, ftRegistered, NEAR, TGAS, toUnits, units, view, yocto, type Call } from "./near.js";
import type { User } from "./store.js";

export interface Coin { id: number; account_id: string; name: string; symbol: string; pair: string; creator: string; created_at_ms: number; hidden: boolean }
export type PairAsset = "Near" | { Token: { account_id: string; symbol: string; decimals: number } };
export interface Info {
  name: string; symbol: string; icon?: string | null; creator: string; pair: PairAsset; virtual_reserve: string; buy_tax_bps: number; sell_tax_bps: number;
  split: { creator_bps: number; dividends_bps: number; burn_bps: number; liquidity_bps: number };
  phase: "Curve" | "Graduating" | "Rhea" | string; total_supply: string; tokens_sold: string; raised: string; pool_pair: string; pool_tokens: string;
  price: string; market_cap: string; graduation: string; curve_supply: string; burned: string; dividends_total: string; trades: number; holders: number;
  dex: string; pool_id: number | null; lp_shares: string; created_at_ms: number; links: { website?: string | null; x?: string | null; telegram?: string | null };
}
export interface Holder { balance: string; claimable_dividends: string; credit: string }
interface DexPool { token_account_ids: string[]; amounts: string[]; total_fee: number }

export const COIN_STORAGE = 4n * 10n ** 21n; // 0.004 NEAR per holder
const WNEAR_STORAGE = 1250n * 10n ** 18n;   // 0.00125 NEAR
const STOCK_STORAGE = 125n * 10n ** 20n;    // 0.0125 NEAR
const DCL_FEES = [100, 400, 2000, 10000];

// ---- prices -------------------------------------------------------------

let nearUsdCache = { v: 0, t: 0 };
export async function nearUsd(): Promise<number> {
  if (Date.now() - nearUsdCache.t < 60_000 && nearUsdCache.v) return nearUsdCache.v;
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=near&vs_currencies=usd", { signal: AbortSignal.timeout(8000) });
    const j = (await r.json()) as { near?: { usd?: number } };
    if (j.near?.usd) nearUsdCache = { v: j.near.usd, t: Date.now() };
  } catch { /* keep the last value */ }
  return nearUsdCache.v;
}

let stockCache: { m: Map<string, number>; t: number } = { m: new Map(), t: 0 };
export async function stockUsd(account: string): Promise<number> {
  if (Date.now() - stockCache.t > 300_000) {
    try {
      const r = await fetch("https://1click.chaindefuser.com/v0/tokens?ondoTokens", { signal: AbortSignal.timeout(10_000) });
      const list = (await r.json()) as { assetId: string; price?: number }[];
      const m = new Map<string, number>();
      for (const t of list) if (t.price) m.set(t.assetId.replace(/^nep141:/, ""), t.price);
      stockCache = { m, t: Date.now() };
    } catch { /* keep */ }
  }
  return stockCache.m.get(account) ?? 0;
}

/** Dollars per whole unit of the pair asset. */
export const pairUsd = (pair: PairAsset) => (pair === "Near" ? nearUsd() : stockUsd(pair.Token.account_id));
export const pairDec = (pair: PairAsset) => (pair === "Near" ? 24 : pair.Token.decimals);
export const pairSym = (pair: PairAsset) => (pair === "Near" ? "NEAR" : pair.Token.symbol);
export const pairToken = (pair: PairAsset) => (pair === "Near" ? config.wnear : pair.Token.account_id);

// ---- coins ---------------------------------------------------------------

let coinsCache: { list: Coin[]; t: number } = { list: [], t: 0 };
export async function listCoins(force = false): Promise<Coin[]> {
  if (!force && Date.now() - coinsCache.t < 30_000 && coinsCache.list.length) return coinsCache.list;
  const list = await view<Coin[]>(config.factory, "list", { limit: 200, include_hidden: false });
  coinsCache = { list: list.filter((c) => !c.hidden), t: Date.now() };
  return coinsCache.list;
}

/** A pasted account, symbol, or chipfi.fun link to a coin. */
export async function resolveCoin(text: string): Promise<Coin | null> {
  const t = text.trim();
  const fromUrl = t.match(/\/t\/([a-z0-9._-]+\.near)/i)?.[1];
  const acct = fromUrl ?? (/^[a-z0-9._-]+\.near$/i.test(t) ? t.toLowerCase() : null);
  const coins = await listCoins();
  if (acct) {
    const c = coins.find((c) => c.account_id === acct);
    if (c) return c;
    // A coin the cache has not seen yet, or a hidden one typed on purpose.
    const all = await listCoins(true);
    return all.find((c) => c.account_id === acct) ?? null;
  }
  const sym = t.replace(/^\$/, "").toUpperCase();
  return coins.find((c) => c.symbol.toUpperCase() === sym) ?? coins.find((c) => c.name.toUpperCase() === sym) ?? null;
}

export const getInfo = (acct: string) => view<Info>(acct, "get_info", {});
export const getHolder = (acct: string, who: string) => view<Holder>(acct, "get_holder", { account_id: who }).catch(() => ({ balance: "0", claimable_dividends: "0", credit: "0" } as Holder));
export const getPool = (dex: string, poolId: number) => view<DexPool>(dex, "get_pool", { pool_id: poolId });

/** The coin's liquidity in the pair asset: the raise on the curve, the
 *  pair side of the Rhea pool after. */
export async function liquidity(i: Info): Promise<bigint> {
  if (i.pool_id != null) {
    const p = await getPool(i.dex, i.pool_id).catch(() => null);
    if (p) { const k = p.token_account_ids.indexOf(pairToken(i.pair)); if (k >= 0) return BigInt(p.amounts[k]); }
  }
  return BigInt(i.raised);
}

// ---- quotes --------------------------------------------------------------

/** Tokens out for pair in. On the curve the contract prices it; on Rhea we
 *  price against the pool like the site does. */
export async function quoteBuy(acct: string, i: Info, pairIn: bigint): Promise<bigint> {
  if (i.pool_id == null) return BigInt(await view<string>(acct, "quote_buy", { pair_in: pairIn.toString() }));
  const p = await getPool(i.dex, i.pool_id);
  const kp = p.token_account_ids.indexOf(pairToken(i.pair)); const kt = p.token_account_ids.indexOf(acct);
  const rp = BigInt(p.amounts[kp]); const rt = BigInt(p.amounts[kt]);
  const inNet = pairIn - (pairIn * BigInt(p.total_fee)) / 10000n;
  const tokens = (rt * inNet) / (rp + inNet);
  return tokens - (tokens * BigInt(i.buy_tax_bps)) / 10000n;
}

export async function quoteSell(acct: string, i: Info, tokensIn: bigint): Promise<bigint> {
  if (i.pool_id == null) return BigInt(await view<string>(acct, "quote_sell", { tokens_in: tokensIn.toString() }));
  const p = await getPool(i.dex, i.pool_id);
  const kp = p.token_account_ids.indexOf(pairToken(i.pair)); const kt = p.token_account_ids.indexOf(acct);
  const rp = BigInt(p.amounts[kp]); const rt = BigInt(p.amounts[kt]);
  const afterTax = tokensIn - (tokensIn * BigInt(i.sell_tax_bps)) / 10000n;
  const inNet = afterTax - (afterTax * BigInt(p.total_fee)) / 10000n;
  return (rp * inNet) / (rt + inNet);
}

interface DclQuote { poolId: string; amountOut: bigint; fee: number }

/** Best Rhea DCL pool between a stock and wNEAR, in either direction. */
export async function dclQuote(tokenIn: string, tokenOut: string, amountIn: bigint): Promise<DclQuote | null> {
  const stock = tokenIn === config.wnear ? tokenOut : tokenIn;
  const qs = await Promise.all(DCL_FEES.map(async (fee) => {
    const poolId = [stock, config.wnear].sort().join("|") + `|${fee}`;
    try {
      const r = await view<{ amount: string }>(config.dcl, "quote", { pool_ids: [poolId], input_token: tokenIn, output_token: tokenOut, input_amount: amountIn.toString(), tag: null });
      return BigInt(r.amount) > 0n ? { poolId, amountOut: BigInt(r.amount), fee } : null;
    } catch { return null; }
  }));
  return qs.filter((q): q is DclQuote => !!q).sort((a, b) => (b.amountOut > a.amountOut ? 1 : -1))[0] ?? null;
}

const dclMsg = (poolId: string, outputToken: string, minOut: bigint) => JSON.stringify({ Swap: { pool_ids: [poolId], output_token: outputToken, min_output_amount: minOut.toString() } });
const refMsg = (poolId: number, tokenIn: string, tokenOut: string, minOut: bigint) => JSON.stringify({ force: 0, actions: [{ pool_id: poolId, token_in: tokenIn, token_out: tokenOut, min_amount_out: minOut.toString() }] });

// ---- trades --------------------------------------------------------------

export interface BuyPlan { steps: Call[][]; tokensOut: bigint; pairIn: bigint; note: string }

/** What a buy of `nearIn` NEAR costs and does. A stock-paired coin takes a
 *  first hop through Rhea's pool to turn the NEAR into the stock. */
export async function planBuy(u: User, acct: string, i: Info, nearIn: bigint): Promise<BuyPlan> {
  const slip = BigInt(u.slippageBps);
  const floor = (v: bigint) => v - (v * slip) / 10000n;
  const [coinReg, wnearReg] = await Promise.all([ftRegistered(acct, u.accountId), ftRegistered(config.wnear, u.accountId)]);
  const register: Call[] = coinReg ? [] : [{ receiverId: acct, method: "storage_deposit", args: { account_id: u.accountId, registration_only: true }, deposit: COIN_STORAGE, gas: TGAS(30) }];
  const wrap: Call[] = [
    ...(wnearReg ? [] : [{ receiverId: config.wnear, method: "storage_deposit", args: { account_id: u.accountId, registration_only: true }, deposit: WNEAR_STORAGE, gas: TGAS(30) }]),
    { receiverId: config.wnear, method: "near_deposit", args: {}, deposit: nearIn, gas: TGAS(30) },
  ];

  if (i.pair === "Near") {
    if (i.pool_id == null) {
      const out = await quoteBuy(acct, i, coinReg ? nearIn : nearIn - COIN_STORAGE);
      return { steps: [[{ receiverId: acct, method: "buy", args: { min_out: floor(out).toString(), for_account: null }, deposit: nearIn, gas: TGAS(100) }]], tokensOut: out, pairIn: nearIn, note: "on the curve" };
    }
    const out = await quoteBuy(acct, i, nearIn);
    const minRaw = (floor(out) * 10000n) / (10000n - BigInt(i.buy_tax_bps));
    return { steps: [[...register, ...wrap, { receiverId: config.wnear, method: "ft_transfer_call", args: { receiver_id: config.dex, amount: nearIn.toString(), msg: refMsg(i.pool_id, config.wnear, acct, minRaw) }, deposit: 1n, gas: TGAS(180) }]], tokensOut: out, pairIn: nearIn, note: "on Rhea" };
  }

  // Stock pair: NEAR -> stock on Rhea DCL, then the stock into the coin.
  const stock = i.pair.Token.account_id;
  const q = await dclQuote(config.wnear, stock, nearIn);
  if (!q) throw new Error(`No NEAR pool for ${i.pair.Token.symbol} on Rhea right now. Send ${i.pair.Token.symbol} to your bot wallet instead, or try on the site when NEAR Intents is open.`);
  const stockReg = await ftRegistered(stock, u.accountId);
  const hop: Call[] = [
    ...(stockReg ? [] : [{ receiverId: stock, method: "storage_deposit", args: { account_id: u.accountId, registration_only: true }, deposit: STOCK_STORAGE, gas: TGAS(30) }]),
    ...wrap,
    { receiverId: config.wnear, method: "ft_transfer_call", args: { receiver_id: config.dcl, amount: nearIn.toString(), msg: dclMsg(q.poolId, stock, floor(q.amountOut)) }, deposit: 1n, gas: TGAS(180) },
  ];
  const stockIn = floor(q.amountOut);
  const out = await quoteBuy(acct, i, stockIn);
  const buy: Call[] = i.pool_id == null
    ? [...register, { receiverId: stock, method: "ft_transfer_call", args: { receiver_id: acct, amount: "__STOCK__", msg: JSON.stringify({ min_out: floor(out).toString() }) }, deposit: 1n, gas: TGAS(100) }]
    : [...register, { receiverId: stock, method: "ft_transfer_call", args: { receiver_id: config.dex, amount: "__STOCK__", msg: refMsg(i.pool_id, stock, acct, (floor(out) * 10000n) / (10000n - BigInt(i.buy_tax_bps))) }, deposit: 1n, gas: TGAS(180) }];
  return { steps: [hop, buy], tokensOut: out, pairIn: stockIn, note: `NEAR → ${i.pair.Token.symbol} on Rhea (${q.fee / 10000}% pool), then ${i.pool_id == null ? "the curve" : "Rhea"}` };
}

export interface SellPlan { steps: Call[][]; pairOut: bigint; nearOut: bigint | null; note: string }

/** Selling `tokens`. On the curve the pair is credited and claimed in the
 *  same transaction; on Rhea it comes back as wNEAR and is unwrapped. A stock
 *  pair is turned back into NEAR through Rhea DCL when a pool quotes. */
export async function planSell(u: User, acct: string, i: Info, tokens: bigint): Promise<SellPlan> {
  const slip = BigInt(u.slippageBps);
  const floor = (v: bigint) => v - (v * slip) / 10000n;
  const out = await quoteSell(acct, i, tokens);
  const steps: Call[][] = [];
  const stock = i.pair === "Near" ? null : i.pair.Token.account_id;
  if (i.pool_id == null) {
    steps.push([
      { receiverId: acct, method: "sell", args: { amount: tokens.toString(), min_out: floor(out).toString() }, gas: TGAS(100) },
      { receiverId: acct, method: "claim", args: {}, gas: TGAS(60) },
    ]);
  } else {
    const wnearReg = await ftRegistered(config.wnear, u.accountId);
    steps.push([
      ...(i.pair === "Near" && !wnearReg ? [{ receiverId: config.wnear, method: "storage_deposit", args: { account_id: u.accountId, registration_only: true }, deposit: WNEAR_STORAGE, gas: TGAS(30) }] : []),
      { receiverId: acct, method: "ft_transfer_call", args: { receiver_id: config.dex, amount: tokens.toString(), msg: refMsg(i.pool_id, acct, pairToken(i.pair), floor(out)) }, deposit: 1n, gas: TGAS(180) },
    ]);
    if (i.pair === "Near") steps.push([{ receiverId: config.wnear, method: "near_withdraw", args: { amount: "__WNEAR__" }, deposit: 1n, gas: TGAS(30) }]);
  }
  if (!stock) return { steps, pairOut: out, nearOut: out, note: i.pool_id == null ? "on the curve" : "on Rhea" };
  const stockSym = pairSym(i.pair);
  const q = await dclQuote(stock, config.wnear, floor(out));
  if (q) steps.push([{ receiverId: stock, method: "ft_transfer_call", args: { receiver_id: config.dcl, amount: "__STOCK__", msg: dclMsg(q.poolId, config.wnear, floor(q.amountOut)) }, deposit: 1n, gas: TGAS(180) }]);
  return { steps, pairOut: out, nearOut: q ? q.amountOut : null, note: q ? `${stockSym} back to NEAR on Rhea` : `${stockSym} stays in your wallet (no NEAR pool right now)` };
}

/** Fills the amount placeholders from live balances before a step runs. */
export async function fillPlaceholders(u: User, step: Call[], before: { stock?: bigint; wnear?: bigint }, stock?: string): Promise<Call[]> {
  const out: Call[] = [];
  for (const c of step) {
    const args = { ...(c.args ?? {}) };
    if (args.amount === "__STOCK__" && stock) { const now = await ftBalance(stock, u.accountId); const got = now - (before.stock ?? 0n); args.amount = got.toString(); if (got <= 0n) throw new Error("The first hop did not deliver the stock; nothing to buy with."); }
    if (args.amount === "__WNEAR__") { const now = await ftBalance(config.wnear, u.accountId); args.amount = now.toString(); if (now === 0n) continue; }
    out.push({ ...c, args });
  }
  return out;
}

// ---- formatting ---------------------------------------------------------

export const fmt = (n: number, d = 2) => n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n >= 1 ? n.toFixed(d) : n === 0 ? "0" : n.toPrecision(3);
export const usd = (n: number) => (n === 0 ? "$0" : n < 0.01 ? `$${n.toPrecision(2)}` : `$${fmt(n)}`);
export const ago = (ms: number) => { const s = Math.max(0, Date.now() - ms) / 1000; return s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`; };
export { NEAR, toUnits, units, yocto };
