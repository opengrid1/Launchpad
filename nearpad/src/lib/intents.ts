/** NEAR Intents, through the 1Click API: the way to turn NEAR into a
 *  tokenized stock without leaving NEAR. The stock tokens live in Intents as
 *  BNB-side assets, so a swap lands in the buyer's Intents balance and is
 *  then withdrawn to their NEAR wallet, where the coin contracts expect it. */

export const ONECLICK = "https://1click.chaindefuser.com/v0";
export const INTENTS_CONTRACT = "intents.near";
export const INTENTS_APP = "https://app.near-intents.org";
export const WNEAR_ASSET = "nep141:wrap.near";

export const assetOf = (account: string) => `nep141:${account}`;

export interface Quote {
  amountIn: string;
  amountInFormatted: string;
  amountInUsd: string;
  amountOut: string;
  amountOutFormatted: string;
  amountOutUsd: string;
  minAmountOut: string;
  timeEstimate: number;
  depositAddress?: string;
  depositMemo?: string;
  deadline?: string;
}

export type SwapStatus = "KNOWN_DEPOSIT_TX" | "PENDING_DEPOSIT" | "INCOMPLETE_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED";

export interface StatusResponse {
  status: SwapStatus;
  swapDetails?: { amountOut?: string; amountOutFormatted?: string; destinationChainTxHashes?: { hash: string }[] };
}

export class NoLiquidity extends Error {}

/** A quote for NEAR into a stock token, delivered to the buyer's Intents
 *  account. `dry` prices it without reserving a deposit address. */
export async function quoteNearToStock(opts: { account: string; stockAccount: string; yoctoIn: string; dry: boolean; slippageBps?: number }): Promise<Quote> {
  const deadline = new Date(Date.now() + 15 * 60_000).toISOString();
  const body = {
    dry: opts.dry,
    swapType: "EXACT_INPUT",
    slippageTolerance: opts.slippageBps ?? 100,
    originAsset: WNEAR_ASSET,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: assetOf(opts.stockAccount),
    amount: opts.yoctoIn,
    refundTo: opts.account,
    refundType: "ORIGIN_CHAIN",
    recipient: opts.account,
    recipientType: "INTENTS",
    deadline,
  };
  const r = await fetch(`${ONECLICK}/quote?ondoTokens`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
  const j = await r.json();
  if (!r.ok) {
    const m = String(j?.message ?? r.statusText);
    if (/liquidity/i.test(m)) throw new NoLiquidity(m);
    throw new Error(m);
  }
  const q = j.quote as Quote;
  return { ...q, depositAddress: q.depositAddress, depositMemo: q.depositMemo, deadline: j.quoteRequest?.deadline ?? deadline };
}

export async function swapStatus(depositAddress: string, memo?: string): Promise<StatusResponse> {
  const u = new URL(`${ONECLICK}/status`);
  u.searchParams.set("depositAddress", depositAddress);
  if (memo) u.searchParams.set("depositMemo", memo);
  const r = await fetch(u, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`status ${r.status}`);
  return (await r.json()) as StatusResponse;
}

export async function submitDeposit(depositAddress: string, txHash: string, memo?: string) {
  try {
    await fetch(`${ONECLICK}/deposit/submit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ txHash, depositAddress, ...(memo ? { depositMemo: memo } : {}) }), signal: AbortSignal.timeout(20_000) });
  } catch { /* optional: status polling finds it anyway */ }
}

/** The BNB Chain contract behind a bridged Ondo token account like bnb-0x….omdep.near. */
export const bnbAddress = (account: string) => { const m = account.match(/^bnb-(0x[0-9a-f]{40})\.omdep\.near$/i); return m ? m[1] : null; };
export const pancakeUrl = (account: string) => { const a = bnbAddress(account); return a ? `https://pancakeswap.finance/swap?chain=bsc&outputCurrency=${a}` : null; };

/** Rhea's concentrated-liquidity exchange. Some stocks have NEAR pools there,
 *  which price them on-chain around the clock, weekends included. */
export const DCL = "dclv2.ref-labs.near";
const DCL_FEES = [100, 400, 2000, 10000];

export interface DclQuote { poolId: string; amountOut: string; fee: number }

/** The best NEAR-to-stock quote across the stock's Rhea DCL pools, or null
 *  when the stock has none. */
export async function quoteNearToStockOnRhea(stockAccount: string, yoctoIn: string, viewFn: <T>(c: string, m: string, a: Record<string, unknown>) => Promise<T>): Promise<DclQuote | null> {
  const pools = DCL_FEES.map((fee) => ({ fee, poolId: [stockAccount, WNEAR_ASSET.slice(7)].sort().join("|") + `|${fee}` }));
  const quotes = await Promise.all(pools.map(async (p) => {
    try {
      const r = await viewFn<{ amount: string }>(DCL, "quote", { pool_ids: [p.poolId], input_token: WNEAR_ASSET.slice(7), output_token: stockAccount, input_amount: yoctoIn, tag: null });
      return BigInt(r.amount) > 0n ? { ...p, amountOut: r.amount } : null;
    } catch { return null; }
  }));
  return quotes.filter((q): q is DclQuote => !!q).sort((a, b) => (BigInt(b.amountOut) > BigInt(a.amountOut) ? 1 : -1))[0] ?? null;
}

/** The ft_transfer_call message that swaps through a DCL pool. */
export const dclSwapMsg = (poolId: string, outputToken: string, minOut: string) =>
  JSON.stringify({ Swap: { pool_ids: [poolId], output_token: outputToken, min_output_amount: minOut } });
