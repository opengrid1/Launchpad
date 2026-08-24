import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTokens } from "@launchpad/sdk/react";
import type { TokenSummary } from "@launchpad/sdk";

import { WHYPE, hyperStockByAddress } from "../lib/hyper/stocks";
import { client } from "../lib/client";
import { env } from "../lib/env";
import { fmtUsd } from "../lib/format";
import { isHidden, isImpersonator } from "../lib/hiddenTokens";
import { isOfficial } from "../lib/official";
import { OFFICIAL_LOGOS } from "../lib/officialLogos";
import { volUsd } from "../components/market/util";
import { KoiIcon } from "../components/base/KoiIcon";
import { HyperMark } from "../components/HyperMark";
import { DEFAULT_TOKEN_LOGO } from "../lib/hyper/defaultLogo";
import { ensureSdkWallet, errorText, useWallet } from "../lib/useWallet";
import { useUi } from "../store";

/** Quick-buy presets, in whole units of the chain's native token (HYPE). Each
 *  fires a real buy through the connected wallet, spending native value for the
 *  coin without leaving the page. */
const QUICK_BUY_AMOUNTS = [1, 5, 10, 25];

/** Shared quick-buy: sizes a native-token amount into wei and fires a real buy
 *  through the connected wallet. Used by both the row bolt and the hero leader
 *  cards. Passes minOut = 0n (best-effort quick buy). */
function useQuickBuy(token: `0x${string}`, symbol: string, onDone?: () => void) {
  const { isConnected, connectFirst } = useWallet();
  const pushToast = useUi((s) => s.pushToast);
  const [busyAmt, setBusyAmt] = useState<number | null>(null);

  const buy = async (amt: number) => {
    if (busyAmt != null) return;
    if (!isConnected) { onDone?.(); return connectFirst(); }
    setBusyAmt(amt);
    try {
      if (!(await ensureSdkWallet())) throw new Error("Wallet session expired. Reconnect and try again.");
      const value = BigInt(Math.round(amt * 1e18));
      const hash = await (client as any).buyToken(token, value, 0n);
      pushToast({ kind: "success", title: `Buying ${amt} ${env.nativeSymbol} of ${symbol}`, txHash: hash });
      onDone?.();
    } catch (err) {
      pushToast({ kind: "error", title: "Quick buy failed", body: errorText(err) });
    } finally {
      setBusyAmt(null);
    }
  };
  return { buy, busyAmt };
}

/** The preset buttons shown in the hero leader cards — always visible, each
 *  fires a real quick buy in the native token. */
function LeaderBuy({ token, symbol }: { token: `0x${string}`; symbol: string }) {
  const { buy, busyAmt } = useQuickBuy(token, symbol);
  return (
    <div className="kf-buy-row" onClick={(e) => e.preventDefault()}>
      {QUICK_BUY_AMOUNTS.map((a) => (
        <button key={a} className="kf-buy-btn" disabled={busyAmt != null}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); buy(a); }}>
          {busyAmt === a ? "…" : a}
        </button>
      ))}
    </div>
  );
}

/** The row's lightning bolt reveals a full-width strip of native-token presets
 *  on a second line, each firing a real buy. */
function QuickBuyBolt({ token, symbol }: { token: `0x${string}`; symbol: string }) {
  const [open, setOpen] = useState(false);
  const { buy, busyAmt } = useQuickBuy(token, symbol, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (!el.closest?.(`[data-qb="${token}"]`)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open, token]);

  return (
    <>
      <button
        className={`kf-bolt ${open ? "on" : ""}`}
        data-qb={token}
        aria-label={`Quick buy ${symbol}`}
        aria-expanded={open}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}
      >
        {BOLT}
      </button>
      {open ? (
        <span className="kf-qb-strip" data-qb={token} role="group" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
          {QUICK_BUY_AMOUNTS.map((a) => (
            <button key={a} className="kf-qb-amt" disabled={busyAmt != null} onClick={() => buy(a)}>
              {busyAmt === a ? "…" : a}
            </button>
          ))}
        </span>
      ) : null}
    </>
  );
}

type Tab = "top" | "trending" | "movers" | "new" | "live";
const TABS: { id: Tab; label: string; live?: boolean }[] = [
  { id: "top", label: "Top" },
  { id: "trending", label: "Trending" },
  { id: "movers", label: "Movers" },
  { id: "live", label: "Live", live: true },
];

/* ---- pair (the asset each coin trades against; the creator earns its fees) ---- */
const pairSymbolOf = (t: TokenSummary): string | null => {
  const meta = t.metadata as any;
  const addr = meta?.pairAddress as string | undefined;
  if (addr) {
    if (addr.toLowerCase() === WHYPE.toLowerCase()) return env.nativeSymbol;
    const st = hyperStockByAddress(addr);
    if (st) return st.ticker;
  }
  const p = meta?.pair as string | undefined;
  if (p) return /^w?hype$/i.test(p) ? env.nativeSymbol : p;
  return null;
};

/* ---- circular avatar: token logo, else the liquidstock droplet default ---- */
const DEFAULT_LOGO = DEFAULT_TOKEN_LOGO;
function logoSrc(t: TokenSummary): string | null {
  const logo = OFFICIAL_LOGOS[t.address?.toLowerCase()] ?? t.metadata?.logo;
  if (!logo || !/^(https?:|ipfs:|data:)/.test(String(logo))) return null;
  return String(logo).startsWith("ipfs://") ? `https://ipfs.io/ipfs/${String(logo).slice(7)}` : String(logo);
}
function Avatar({ t }: { t: TokenSummary }) {
  const [failed, setFailed] = useState(false);
  const src = (failed ? null : logoSrc(t)) ?? DEFAULT_LOGO;
  return (
    <span className="kf-ava-wrap">
      <span className="kf-ava">
        <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
      </span>
      <span className="kf-badge">{HYPER_MARK}</span>
    </span>
  );
}

// The official Hyperliquid mark badges every coin as launched on HyperEVM.
const HYPER_MARK = <HyperMark />;
const FIRE = <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="kf-fire"><path d="M12 2.5C8.7 6.7 6.2 9.7 6.2 13.4a5.8 5.8 0 0 0 11.6 0c0-3.7-2.5-6.7-5.8-10.9Zm0 16.3a3 3 0 0 1-3-3c0-1.4 1.1-2.8 3-4.2 1.9 1.4 3 2.8 3 4.2a3 3 0 0 1-3 3Z" /></svg>;
const CUP = <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="kf-cup"><path d="M7 3h10v2h3.5v2.2A3.8 3.8 0 0 1 16.7 11h-.3a5 5 0 0 1-3.4 2.9V16h3v2.5H8V16h3v-2.1A5 5 0 0 1 7.6 11h-.3a3.8 3.8 0 0 1-3.8-3.8V5H7V3Zm-1.5 4.2c0 1 .8 1.8 1.8 1.8h-.1A6.9 6.9 0 0 1 7 5.5H5.5v1.7ZM18.5 7.2V5.5H17c.1 1.2 0 2.4-.2 3.5h-.1c1 0 1.8-.8 1.8-1.8Z" /></svg>;
const UP_TRI = <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M12 6l7 12H5z" /></svg>;
const DN_TRI = <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M12 18 5 6h14z" /></svg>;
const BOLT = <KoiIcon name="zap" size={18} />;

function ordinal(n: number) {
  return ["th", "st", "nd", "rd"][n % 10 > 3 || (n % 100 >= 11 && n % 100 <= 13) ? 0 : n % 10];
}

/**
 * liquidstock discovery dashboard — a koi.fun-styled "Today's leaders" board
 * over a live pool list, wired to real HyperEVM launches. liquidstock coins do
 * not reward holders; the product's hook is that every trade pays the creator
 * the pool's 1% fee forever, so each row surfaces the coin's trading pair.
 */
export function HyperBoard() {
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get("tab") as Tab) || "movers";
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const showSearch = sp.get("focus") === "1" || debounced.length > 0;

  const { data: byVolume, loading: lv } = useTokens(client, { sort: "volume", limit: 100 });
  const { data: byNew, loading: ln } = useTokens(client, { sort: "new", limit: 100 });

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query.trim().toLowerCase()), 130);
    return () => window.clearTimeout(id);
  }, [query]);
  useEffect(() => { if (sp.get("focus") === "1") searchRef.current?.focus(); }, [sp]);

  const setTab = (id: Tab) => {
    const n = new URLSearchParams(sp);
    n.delete("focus");
    if (id === "movers") n.delete("tab"); else n.set("tab", id);
    setSp(n, { replace: true });
  };

  const all = useMemo(() => {
    if (env.hideTokens) return [] as TokenSummary[];
    const seen = new Map<string, TokenSummary>();
    for (const t of [...(byVolume ?? []), ...(byNew ?? [])]) {
      if (!isHidden(t.address) && !isImpersonator(t)) seen.set(t.address.toLowerCase(), t);
    }
    return [...seen.values()];
  }, [byVolume, byNew]);


  const feed = useMemo(() => {
    let list = all;
    if (debounced) list = list.filter((t) => t.name.toLowerCase().includes(debounced) || t.symbol.toLowerCase().includes(debounced) || t.address.toLowerCase() === debounced);
    const s = [...list];
    if (tab === "top") s.sort((a, b) => Number(b.marketCapUsd) - Number(a.marketCapUsd));
    else if (tab === "trending") s.sort((a, b) => volUsd(b) - volUsd(a));
    else if (tab === "new") s.sort((a, b) => b.createdAt - a.createdAt);
    else if (tab === "live") { s.sort((a, b) => (b.txCount24h ?? 0) - (a.txCount24h ?? 0) || b.createdAt - a.createdAt); }
    else s.sort((a, b) => (b.priceChange24hPct ?? -999) - (a.priceChange24hPct ?? -999) || volUsd(b) - volUsd(a));
    return s;
  }, [all, debounced, tab]);

  const loading = !env.hideTokens && (lv || ln) && all.length === 0;

  return (
    <div className="kf kf-page">
      {/* Section head */}
      <div className="kf-sec-head">
        <h1 className="kf-sec-title">Pools</h1>
      </div>

      {/* Tabs */}
      <nav className="kf-tabs" aria-label="Pool views">
        {TABS.map((t) => (
          <button key={t.id} className={`kf-tab ${tab === t.id ? "on" : ""}`} onClick={() => setTab(t.id)}>
            {t.live ? <span className="kf-live-dot" /> : null}{t.label}
          </button>
        ))}
      </nav>

      {/* Search (revealed by the nav search action) */}
      {showSearch && (
        <div style={{ padding: "0 16px 8px" }}>
          <label className="relative block">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            </span>
            <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search coins…" type="search"
              className="h-11 w-full rounded-2xl border border-edge bg-panel pl-9 pr-3 text-[14px] text-ink outline-none placeholder:text-ink-3 focus:border-edge-2" />
          </label>
        </div>
      )}

      {/* Pool list */}
      <div className="kf-pools">
        {loading ? (
          [...Array(8)].map((_, i) => <div key={i} className="kf-skel" />)
        ) : feed.length === 0 ? (
          <div className="kf-empty">
            {debounced ? "No match. " : "No coins launched yet. "}
            <Link to="/launch">Launch the first one</Link>.
          </div>
        ) : (
          feed.map((t) => {
            const chg = t.priceChange24hPct;
            const has = chg != null && isFinite(chg);
            const hot = has && chg! >= 20;
            const official = isOfficial(t.address);
            const fresh = !!t.createdAt && Date.now() / 1000 - t.createdAt < 86400;
            const tint = has ? (chg! >= 0 ? "tint-up" : "tint-dn") : "";
            const pair = pairSymbolOf(t);
            return (
              <Link to={`/token/${t.address}`} key={t.address} className={`kf-pool ${tint}`}>
                <Avatar t={t} />
                <span className="kf-pool-mid">
                  <span className="kf-pool-name-row">
                    <span className="kf-pool-name">{t.name}</span>
                    {(hot || official) && <span className="kf-flags">{hot && FIRE}{official && CUP}</span>}
                    {fresh && <span className="kf-new-badge">New</span>}
                  </span>
                  <span className="kf-pool-sub">
                    <span className="kf-tk">{t.symbol}</span>
                    {pair ? <span className="kf-pill">pairs {pair}</span> : null}
                    {volUsd(t) > 0 ? <span className="kf-vol">· {fmtUsd(volUsd(t))} vol</span> : null}
                  </span>
                </span>
                <span className="kf-pool-right">
                  <span className="kf-pool-mc">{Number(t.marketCapUsd) > 0 ? fmtUsd(t.marketCapUsd) : "—"}</span>
                  <span className={`kf-pool-chg ${has ? (chg! >= 0 ? "up" : "down") : "flat"}`}>
                    {has ? (chg! >= 0 ? UP_TRI : DN_TRI) : null}{has ? `${chg! >= 0 ? "+" : ""}${chg!.toFixed(2)}%` : "0.00%"}
                  </span>
                </span>
                <QuickBuyBolt token={t.address as `0x${string}`} symbol={t.symbol} />
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
