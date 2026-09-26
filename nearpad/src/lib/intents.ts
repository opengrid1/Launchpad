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
