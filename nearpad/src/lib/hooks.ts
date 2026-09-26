import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { demoCandles, demoCoins, demoHolder, demoPairs, demoTrades } from "./demo";
import { DEMO, env, HIDDEN } from "./env";
import { mapLimit, view } from "./rpc";
import type { Candle, Coin, CoinRow, Config, Holder, Info, Pair, Trade } from "./types";

// ----------------------------------------------------------------------
// Toasts
// ----------------------------------------------------------------------

export type Toast = { kind: "busy" | "ok" | "err"; text: string; hash?: string } | null;
let toastState: Toast = null;
const toastSubs = new Set<(t: Toast) => void>();
let toastTimer: number | undefined;
export function setToast(t: Toast, ttl = 6000) {
  toastState = t;
  toastSubs.forEach((f) => f(t));
  window.clearTimeout(toastTimer);
  if (t && t.kind !== "busy") toastTimer = window.setTimeout(() => setToast(null), ttl);
}
export function useToast() {
  const [t, setT] = useState<Toast>(toastState);
  useEffect(() => { toastSubs.add(setT); return () => { toastSubs.delete(setT); }; }, []);
  return t;
}

export function friendlyError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/user (rejected|cancel)/i.test(m) || /cancelled/i.test(m)) return "Cancelled in the wallet.";
  const smart = m.match(/Smart contract panicked: (.+?)(\n|$)/);
  if (smart) return smart[1];
  return m.length > 160 ? m.slice(0, 160) + "…" : m;
}

// ----------------------------------------------------------------------
// Reads
// ----------------------------------------------------------------------

export function useConfig() {
  return useQuery({
    queryKey: ["config"],
    queryFn: () => (DEMO ? { owner: "you.near", treasury: "treasury.near", launch_fee: "500000000000000000000000", coin_state_deposit: "500000000000000000000000", paused: false, current_version: { version: "0.1.0", code_hash: "", published_at_block: 0 }, count: demoCoins().length } as Config : view<Config>(env.factory, "get_config")),
    staleTime: 60_000,
  });
}

export function usePairs() {
  return useQuery({
    queryKey: ["pairs"],
    queryFn: () => (DEMO ? demoPairs() : view<Pair[]>(env.factory, "list_pairs")),
    staleTime: 60_000,
  });
}

async function loadCoins(): Promise<Coin[]> {
  if (DEMO) return demoCoins();
  const rows = await view<CoinRow[]>(env.factory, "list", { limit: 200 });
  const infos = await mapLimit(rows, 8, (r) => view<Info>(r.account_id, "get_info").catch(() => null));
  return rows.flatMap((r, i) => (infos[i] && !HIDDEN.has(r.account_id) ? [{ ...r, info: infos[i]! }] : []));
}

export function useCoins() {
  return useQuery({ queryKey: ["coins"], queryFn: loadCoins, refetchInterval: env.pollMs, enabled: DEMO || !!env.factory });
}

export function useCoin(account: string | undefined) {
  return useQuery({
    queryKey: ["coin", account],
    enabled: !!account,
    refetchInterval: env.pollMs,
    queryFn: async (): Promise<Coin | null> => {
      if (DEMO) return demoCoins().find((c) => c.account_id === account) ?? null;
      const info = await view<Info>(account!, "get_info").catch(() => null);
      if (!info) return null;
      const m = account!.match(/^c(\d+)\./);
      const row = m ? await view<CoinRow | null>(env.factory, "get_coin", { id: Number(m[1]) }).catch(() => null) : null;
      return {
        id: row?.id ?? 0, account_id: account!, name: info.name, symbol: info.symbol, pair: row?.pair ?? (info.pair === "Near" ? "NEAR" : info.pair.Token.symbol),
        creator: info.creator, created_at_ms: info.created_at_ms, code_version: row?.code_version ?? "", hidden: row?.hidden ?? false, info,
      };
    },
  });
}

export function useHolder(account: string | undefined, who: string | null | undefined) {
  return useQuery({
    queryKey: ["holder", account, who],
    enabled: !!account && !!who,
    refetchInterval: env.pollMs,
    queryFn: () => (DEMO ? demoHolder() : view<Holder>(account!, "get_holder", { account_id: who })),
  });
}

export function useCandles(account: string | undefined) {
  return useQuery({
    queryKey: ["candles", account],
    enabled: !!account,
    refetchInterval: env.pollMs * 2,
    queryFn: () => (DEMO ? demoCandles() : view<Candle[]>(account!, "get_candles", { limit: 2016 })),
  });
}

export function useTrades(account: string | undefined) {
  return useQuery({
    queryKey: ["trades", account],
    enabled: !!account,
    refetchInterval: env.pollMs,
    queryFn: () => (DEMO ? demoTrades() : view<Trade[]>(account!, "get_trades", { limit: 200 })),
  });
}

/** NEAR in dollars. */
export function useNearUsd() {
  return useQuery({
    queryKey: ["nearusd"],
    staleTime: 60_000,
    queryFn: async () => {
      if (DEMO) return 4.9;
      try {
        const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=near&vs_currencies=usd", { signal: AbortSignal.timeout(8000) });
        const j = await r.json();
        return Number(j?.near?.usd) || 0;
      } catch {
        return 0;
      }
    },
  });
}

/** Holdings across every coin, for the portfolio page. */
export function usePortfolio(who: string | null | undefined) {
  const { data: coins } = useCoins();
  return useQuery({
    queryKey: ["portfolio", who, coins?.length],
    enabled: !!who && !!coins,
    refetchInterval: env.pollMs,
    queryFn: async () => {
      const rows = await mapLimit(coins!, 8, async (c) => ({ coin: c, h: DEMO ? demoHolder() : await view<Holder>(c.account_id, "get_holder", { account_id: who }).catch(() => null) }));
      return rows.filter((r) => r.h && (r.h.balance !== "0" || r.h.credit !== "0" || r.h.claimable_dividends !== "0" || r.coin.info.fee_wallet === who)) as { coin: Coin; h: Holder }[];
    },
  });
}

/** Display currency: NEAR or dollars. Persisted per viewer. */
export function useCurrency(): ["NEAR" | "USD", (c: "NEAR" | "USD") => void] {
  const [c, setC] = useState<"NEAR" | "USD">(() => { try { return (localStorage.getItem("nearpad.ccy") as "NEAR" | "USD") || "USD"; } catch { return "USD"; } });
  useEffect(() => { const on = () => { try { setC((localStorage.getItem("nearpad.ccy") as "NEAR" | "USD") || "USD"); } catch { /* ignore */ } }; window.addEventListener("nearpad:ccy", on); return () => window.removeEventListener("nearpad:ccy", on); }, []);
  return [c, (v) => { try { localStorage.setItem("nearpad.ccy", v); } catch { /* ignore */ } setC(v); window.dispatchEvent(new Event("nearpad:ccy")); }];
}
