/**
 * ETH→USD rate for displaying prices/market caps in USD.
 *
 * The chain's explorer reports no native coin price and the project chart API
 * is session-gated, so we use an external feed (CoinGecko) with a 60s cache.
 * Override with ETH_USD_PRICE (fixed number) or COINGECKO_ID in .env.
 */
const COINGECKO_ID = process.env.COINGECKO_ID || "ethereum";
const FIXED = process.env.ETH_USD_PRICE ? Number(process.env.ETH_USD_PRICE) : null;

let cache: { value: number; at: number } | null = null;
const TTL_MS = 60_000;

export async function getEthUsd(): Promise<number | null> {
  if (FIXED && FIXED > 0) return FIXED;
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  try {
    const res = (await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${COINGECKO_ID}&vs_currencies=usd`,
    ).then((r) => r.json())) as Record<string, { usd?: number }>;
    const value = res[COINGECKO_ID]?.usd;
    if (typeof value === "number" && value > 0) {
      cache = { value, at: Date.now() };
      return value;
    }
  } catch {
    /* fall through */
  }
  return cache?.value ?? null;
}

/** Format a USD amount with sensible precision and thousands separators. */
export function usd(n: number | null): string {
  if (n === null || !isFinite(n)) return "n/a";
  if (n === 0) return "$0";
  if (n < 0.01) return "$" + n.toPrecision(3); // e.g. $0.000635
  const frac = n < 1000 ? 4 : 2;
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: frac });
}
