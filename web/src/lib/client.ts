import { createPublicClient, fallback, http, type PublicClient } from "viem";
import type { LaunchpadClient } from "@launchpad/sdk";

import { chain, env } from "./env";
import { V4Client, type V4Addresses } from "./v4/client";
import { V4SClient } from "./v4s/client";
import { V4S } from "./v4s/addresses";

/** Deployed Quiver V4 launchpad on Robinhood Chain (immutable). */
const V4: V4Addresses = {
  factory: "0x7684E116F10DD7B6634E17cba9A3767CD7B84663",
  hook: "0x1E8fd8f01C44084E514d872AD27455De5c994044",
  router: "0xA5CED4a472586B79c8d744F1b50b8D5a703b1b5d",
  poolManager: "0x8366a39cc670b4001a1121b8f6a443a643e40951",
  weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  usdg: "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
};

const V4_START_BLOCK = 12744439n;

// One or more RPC endpoints (comma-separated in VITE_RPC_URL). Each is retried
// on transient failures (429 rate-limits, 5xx) with backoff, and viem's
// fallback rotates to the next endpoint if one keeps failing — so a single
// overloaded RPC under heavy traffic degrades gracefully instead of blanking
// the app. Adding a backup RPC is a pure env change, no code.
const rpcUrls = env.rpcUrl
  .split(",")
  .map((u) => u.trim())
  .filter(Boolean);

const publicClient = createPublicClient({
  chain,
  transport: fallback(
    rpcUrls.map((url) => http(url, { retryCount: 3, retryDelay: 200, batch: { wait: 16 } })),
  ),
  // Slow the live event watchers from viem's 4s default to 10s. Every open
  // market and the launch feed is watched per visitor, so at scale this is the
  // dominant RPC cost; 10s keeps trades feeling live while cutting that load
  // ~60%. Reads coalesce into Multicall3 within a 24ms window.
  pollingInterval: 10_000,
  batch: { multicall: { wait: 24 } },
}) as PublicClient;

const v4 = new V4Client(publicClient, V4, V4_START_BLOCK);

/**
 * In production, route the heavy bulk reads (token list, single token, trades,
 * candles) through our edge-cached serverless API instead of hitting the RPC
 * from every visitor's browser. Vercel serves these from its CDN, so the chain
 * is read at most once per short cache window no matter how many people are on
 * the site — turning O(users) RPC load into O(1). Any API hiccup transparently
 * falls back to reading straight from the chain, and live event watchers still
 * stream updates over RPC as before. Disabled in dev, where there is no /api.
 */
if (import.meta.env.PROD) {
  const apiGet = async <T>(path: string): Promise<T> => {
    const r = await fetch(`/api${path}`);
    if (!r.ok) throw new Error(`api ${r.status}`);
    return (await r.json()) as T;
  };
  const withApi = <A extends unknown[], R>(
    path: (...args: A) => string,
    rpc: (...args: A) => Promise<R>,
  ) => async (...args: A): Promise<R> => {
    try {
      return await apiGet<R>(path(...args));
    } catch {
      return rpc(...args);
    }
  };
  const q = (v: unknown) => encodeURIComponent(String(v));
  const orig = {
    getTokens: v4.getTokens.bind(v4),
    getToken: v4.getToken.bind(v4),
    getTrades: v4.getTrades.bind(v4),
    getCandles: v4.getCandles.bind(v4),
  };
  v4.getTokens = withApi(
    (opts?: { sort?: string; limit?: number }) => `/tokens?sort=${q(opts?.sort ?? "new")}&limit=${q(opts?.limit ?? 60)}`,
    orig.getTokens,
  ) as typeof v4.getTokens;
  v4.getToken = withApi((token: string) => `/token?address=${q(token)}`, orig.getToken) as typeof v4.getToken;
  v4.getTrades = withApi(
    (token: string, opts?: { limit?: number }) => `/trades?token=${q(token)}&limit=${q(opts?.limit ?? 50)}`,
    orig.getTrades,
  ) as typeof v4.getTrades;
  v4.getCandles = withApi(
    (token: string, interval: string, opts?: { limit?: number }) =>
      `/candles?token=${q(token)}&interval=${q(interval)}&limit=${q(opts?.limit ?? 500)}`,
    orig.getCandles,
  ) as typeof v4.getCandles;
}

/**
 * App-wide client singleton. It is the V4 launchpad client, cast to the v3
 * SDK's client type so the existing React hooks and pages consume it unchanged.
 */
export const client = v4 as unknown as LaunchpadClient;

/** Typed access to V4-only methods (dividends, stock, mcap scale). */
export const v4Client = v4;

/** v4s STOCK-PAIRED launchpad (token/stock pools, reward baskets up to 5). */
const v4s = new V4SClient(
  publicClient,
  {
    factory: V4S.factory,
    hook: V4S.hook,
    router: V4S.router,
    poolManager: V4.poolManager,
    // "weth" is the QUOTE slot of the base client; v4s pools quote in the pair
    // stock per token, so this field is unused for pricing there — kept as WETH
    // for the router's ETH entrances.
    weth: V4.weth,
    usdg: V4.usdg,
  },
  V4S.startBlock,
);

/** Typed access to the stock-paired launchpad. */
export const v4sClient = v4s;

// ---------------------------------------------------------------------------
// Dual-launchpad dispatch: the app talks to ONE client singleton, so per-token
// calls route to whichever factory launched the token. Ownership is resolved
// once and memoised; unknown tokens default to the classic v4 path.
// ---------------------------------------------------------------------------
const ownedByS = new Map<string, boolean>();
async function isV4s(token: string): Promise<boolean> {
  const key = token.toLowerCase();
  const hit = ownedByS.get(key);
  if (hit !== undefined) return hit;
  const owns = (await v4s.getToken(token as `0x${string}`).catch(() => null)) != null;
  ownedByS.set(key, owns);
  return owns;
}

{
  const base = {
    getToken: v4.getToken.bind(v4),
    getTokens: v4.getTokens.bind(v4),
    getTrades: v4.getTrades.bind(v4),
    getCandles: v4.getCandles.bind(v4),
    buyToken: v4.buyToken.bind(v4),
    sellToken: v4.sellToken.bind(v4),
    tokenExtra: v4.tokenExtra.bind(v4),
    pendingDividends: v4.pendingDividends.bind(v4),
    mcapScale: v4.mcapScale.bind(v4),
    stockUsdPrice: v4.stockUsdPrice.bind(v4),
    subscribeToTrades: v4.subscribeToTrades.bind(v4),
    subscribeToCandles: v4.subscribeToCandles.bind(v4),
  };

  v4.getToken = (async (token: string) => {
    try {
      return await base.getToken(token as `0x${string}`);
    } catch (e) {
      const s = await v4s.getToken(token as `0x${string}`).catch(() => null);
      if (s) return s;
      throw e;
    }
  }) as typeof v4.getToken;

  v4.getTokens = (async (opts?: { sort?: string; limit?: number }) => {
    const [a, b] = await Promise.all([
      base.getTokens(opts as any).catch(() => []),
      v4s.getTokens(opts as any).catch(() => []),
    ]);
    return [...b, ...a].sort((x: any, y: any) => (y.createdAt ?? 0) - (x.createdAt ?? 0));
  }) as typeof v4.getTokens;

  const perToken = <A extends unknown[], R>(
    baseFn: (token: string, ...rest: A) => R,
    sFn: (token: string, ...rest: A) => R,
  ) => (async (token: string, ...rest: A) => ((await isV4s(token)) ? sFn(token, ...rest) : baseFn(token, ...rest))) as any;

  v4.getTrades = perToken(base.getTrades as any, v4s.getTrades.bind(v4s) as any);
  v4.getCandles = perToken(base.getCandles as any, v4s.getCandles.bind(v4s) as any);
  v4.buyToken = perToken(base.buyToken as any, v4s.buyToken.bind(v4s) as any);
  v4.sellToken = perToken(base.sellToken as any, v4s.sellToken.bind(v4s) as any);
  v4.tokenExtra = perToken(base.tokenExtra as any, v4s.tokenExtra.bind(v4s) as any);
  v4.pendingDividends = perToken(base.pendingDividends as any, v4s.pendingDividends.bind(v4s) as any);
  v4.mcapScale = perToken(base.mcapScale as any, v4s.mcapScale.bind(v4s) as any);
  // Subscriptions must return their unsubscribe function SYNCHRONOUSLY, so
  // ownership resolves in the background and cleanup stays race-safe.
  const perTokenSub = (baseFn: any, sFn: any) =>
    ((token: string, ...rest: unknown[]) => {
      let un: () => void = () => {};
      let cancelled = false;
      isV4s(token).then((s) => {
        if (!cancelled) un = (s ? sFn : baseFn)(token, ...rest);
      });
      return () => {
        cancelled = true;
        un();
      };
    }) as any;
  v4.subscribeToTrades = perTokenSub(base.subscribeToTrades, v4s.subscribeToTrades.bind(v4s));
  v4.subscribeToCandles = perTokenSub(base.subscribeToCandles, v4s.subscribeToCandles.bind(v4s));
  // stockUsdPrice keys on the STOCK address, not the token — try v4 then v4s.
  v4.stockUsdPrice = (async (stock: `0x${string}`) => {
    const a = await base.stockUsdPrice(stock).catch(() => 0);
    if (a > 0) return a;
    return v4s.stockUsdPrice(stock).catch(() => 0);
  }) as typeof v4.stockUsdPrice;
}
