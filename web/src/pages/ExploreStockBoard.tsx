import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTokens } from "@launchpad/sdk/react";
import type { TokenSummary } from "@launchpad/sdk";

import { BASE_STOCKS, baseStockOf } from "../lib/base/stocks";
import { BASE_USDC, BASE_WETH } from "../lib/base/routes";
import { client } from "../lib/client";
import { env } from "../lib/env";
import { fmtUsd, timeAgo } from "../lib/format";
import { isHidden, isImpersonator } from "../lib/hiddenTokens";
import { isOfficial } from "../lib/official";
import { OFFICIAL_LOGOS } from "../lib/officialLogos";
import { volUsd } from "../components/market/util";

type Tab = "top" | "trending" | "movers" | "new" | "live";
const TABS: { id: Tab; label: string; live?: boolean }[] = [
  { id: "top", label: "Top" },
  { id: "trending", label: "Trending" },
  { id: "movers", label: "Movers" },
  { id: "new", label: "New" },
  { id: "live", label: "Live", live: true },
];

/* ---- reward (the stock/asset each coin pays holders) ---- */
const rewardLabel = (addr?: string) => {
  if (!addr) return null;
  if (addr.toLowerCase() === BASE_WETH.toLowerCase()) return "ETH";
  if (addr.toLowerCase() === BASE_USDC.toLowerCase()) return "USDC";
  return baseStockOf(addr)?.symbol ?? null;
};
const rewardOf = (t: TokenSummary) => rewardLabel((t.metadata as any)?.rewardStock as string | undefined);

/* ---- circular avatar: token logo, else a deterministic gradient disc ---- */
const PALS: [string, string][] = [
  ["#ff59b0", "#c81f7a"], ["#ffb04a", "#ff5d63"], ["#33d6ff", "#1a6bff"], ["#b9f24e", "#33b06a"],
  ["#b06bff", "#5b2bd6"], ["#ff7a5c", "#ff3d78"], ["#39e6c0", "#0e9c8a"], ["#ffd24d", "#ff8a1f"],
  ["#6fc3ff", "#2f7ff0"], ["#ff6f9c", "#e02e6a"],
];
function avaBg(addr: string): string {
  let h = 0;
  for (let i = 0; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) >>> 0;
  const [a, b] = PALS[h % PALS.length];
  return `radial-gradient(60% 55% at 30% 25%, rgba(255,255,255,.5), transparent 55%), linear-gradient(150deg, ${a}, ${b})`;
}
function logoSrc(t: TokenSummary): string | null {
  const logo = OFFICIAL_LOGOS[t.address?.toLowerCase()] ?? t.metadata?.logo;
  if (!logo || !/^(https?:|ipfs:|data:)/.test(String(logo))) return null;
  return String(logo).startsWith("ipfs://") ? `https://ipfs.io/ipfs/${String(logo).slice(7)}` : String(logo);
}
function Avatar({ t }: { t: TokenSummary }) {
  const [failed, setFailed] = useState(false);
  const src = failed ? null : logoSrc(t);
  return (
    <span className="kf-ava-wrap">
      <span className="kf-ava" style={src ? undefined : { background: avaBg(t.address) }}>
        {src ? <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} /> : <span>{(t.symbol || "?")[0].toUpperCase()}</span>}
      </span>
      <span className="kf-badge">{FEATHER}</span>
    </span>
  );
}

const FEATHER = <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M20 4c-6 0-11 3-13 9l-2 5 3-1 1-3h5v-2h-3c1-2 3-3 5-3v-2c2 0 4 0 4 0V4Z" /></svg>;
const FIRE = <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="kf-fire"><path d="M12 2c1.5 3 .5 5-1 6.5C9 10.5 8 12 8 14a4 4 0 0 0 8 .3c0-1.6-.7-2.8-1.3-3.8 2.3.8 3.3 2.7 3.3 5A6 6 0 1 1 7 11c1.3-1.7 2-3.2 2-5 1.6.8 2.4 2 3 3 .4-2.6 0-5-2-7Z" /></svg>;
const CUP = <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="kf-cup"><path d="M6 4h12v3a5 5 0 0 1-4 4.9V15h2.5a1 1 0 0 1 0 2h-9a1 1 0 0 1 0-2H10v-3.1A5 5 0 0 1 6 7V4Zm-2 1H2v1a3 3 0 0 0 3 3V7H4V5Zm16 0v2h-1v2a3 3 0 0 0 3-3V5h-2ZM8 18h8v2H8v-2Z" /></svg>;
const UP_TRI = <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M12 6l7 12H5z" /></svg>;
const DN_TRI = <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M12 18 5 6h14z" /></svg>;
const BOLT = <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" /></svg>;

function ordinal(n: number) {
  return ["th", "st", "nd", "rd"][n % 10 > 3 || (n % 100 >= 11 && n % 100 <= 13) ? 0 : n % 10];
}

// Design-preview fixtures (only used when VITE_PREVIEW=1 and there is no live data).
const mk = (name: string, symbol: string, reward: string, mcap: number, price: number, chg: number, vol: number, age: number): any => ({
  address: `0x${symbol.toLowerCase()}${"0".repeat(38)}`.slice(0, 42), name, symbol, creator: "0x0000000000000000000000000000000000000000",
  marketCapUsd: String(mcap), priceUsd: String(price), priceChange24hPct: chg, txCount24h: Math.round(vol / 500),
  createdAt: Math.floor(Date.now() / 1000) - age, volume24hWei: String(BigInt(Math.round(vol)) * 10n ** 18n), volumeTotalWei: "0", liquidityWei: "0",
  metadata: { rewardStock: BASE_STOCKS.find((s) => s.symbol === reward)?.address ?? (reward === "ETH" ? BASE_WETH : BASE_USDC) },
});
const PREVIEW: TokenSummary[] = [
  mk("pools still open, billa", "OPEN", "GOOGL", 24040, 0.0000241, 71.92, 28190, 7200),
  mk("Tsunami", "TSU", "ETH", 51200, 0.0000512, 41.0, 33800, 3600),
  mk("Koi King", "KOI", "NVDA", 88100, 0.0000881, 27.6, 44300, 90000),
  mk("sushicat", "SUSHI", "META", 234360, 0.000234, 19.34, 125440, 40000),
  mk("Goldfish Gang", "GOLD", "AAPL", 20800, 0.0000208, 15.9, 12400, 15000),
  mk("Onigiri", "ONGR", "COIN", 31790, 0.0000317, 12.42, 13980, 62000),
  mk("Meowshi", "MEOW", "MSTR", 28390, 0.0000283, 8.78, 9360, 26000),
  mk("Flamingo", "FLMGO", "USDC", 39180, 0.0000391, 5.2, 21000, 120000),
  mk("Pixel Pond", "POND", "QQQ", 11200, 0.0000112, 2.1, 5200, 200000),
  mk("Wave Rider", "WAVE", "SPY", 15400, 0.0000154, -4.3, 7700, 260000),
];

/**
 * koi.fun discovery dashboard — an electric-blue "Today's leaders" board over
 * a live pool list, wired to real launches. The product's hook (each coin pays
 * holders a real tokenized stock) rides along as the reward tag on every row.
 */
export function ExploreStockBoard() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get("tab") as Tab) || "movers";
  const [filter, setFilter] = useState<string | null>(null);
  const [dropOpen, setDropOpen] = useState(false);
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
  useEffect(() => {
    if (!dropOpen) return;
    const close = () => setDropOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [dropOpen]);

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
    const list = [...seen.values()];
    if (list.length === 0 && String(import.meta.env.VITE_PREVIEW ?? "") === "1") return PREVIEW;
    return list;
  }, [byVolume, byNew]);

  const leaders = useMemo(() => {
    const withChg = all.filter((t) => { const c = t.priceChange24hPct; return c != null && isFinite(c) && c > 0; });
    const base = (withChg.length >= 3 ? withChg : all).slice();
    base.sort((a, b) => (b.priceChange24hPct ?? 0) - (a.priceChange24hPct ?? 0) || volUsd(b) - volUsd(a));
    return base.slice(0, 6);
  }, [all]);

  const feed = useMemo(() => {
    let list = all;
    if (filter) list = list.filter((t) => rewardOf(t) === filter);
    if (debounced) list = list.filter((t) => t.name.toLowerCase().includes(debounced) || t.symbol.toLowerCase().includes(debounced) || t.address.toLowerCase() === debounced);
    const s = [...list];
    if (tab === "top") s.sort((a, b) => Number(b.marketCapUsd) - Number(a.marketCapUsd));
    else if (tab === "trending") s.sort((a, b) => volUsd(b) - volUsd(a));
    else if (tab === "new") s.sort((a, b) => b.createdAt - a.createdAt);
    else if (tab === "live") { s.sort((a, b) => (b.txCount24h ?? 0) - (a.txCount24h ?? 0) || b.createdAt - a.createdAt); }
    else s.sort((a, b) => (b.priceChange24hPct ?? -999) - (a.priceChange24hPct ?? -999) || volUsd(b) - volUsd(a));
    return s;
  }, [all, filter, debounced, tab]);

  const stats = useMemo(() => ({
    count: all.length,
    mcap: all.reduce((a, t) => a + Number(t.marketCapUsd || 0), 0),
    vol: all.reduce((a, t) => a + volUsd(t), 0),
  }), [all]);

  const rewards = useMemo(() => {
    const set = new Set<string>();
    all.forEach((t) => { const r = rewardOf(t); if (r) set.add(r); });
    return ["ETH", "USDC", ...BASE_STOCKS.map((s) => s.symbol)].filter((r) => set.has(r));
  }, [all]);

  const loading = !env.hideTokens && (lv || ln) && all.length === 0;

  return (
    <div className="kf kf-page">
      {/* Hero / leaders */}
      <section className="kf-hero" aria-label="Today's leaders">
        <div className="kf-hero-head">
          <h2 className="kf-hero-title">Today's leaders</h2>
          <span className="kf-hero-live"><span className="kf-pulse" />Live</span>
        </div>
        <div className="kf-lb-scroll">
          {loading || leaders.length === 0 ? (
            [...Array(3)].map((_, i) => <div key={i} className="kf-lb-card" style={{ height: 168 }} />)
          ) : (
            leaders.map((t, i) => {
              const r = rewardOf(t);
              const chg = t.priceChange24hPct;
              const has = chg != null && isFinite(chg);
              return (
                <Link to={`/token/${t.address}`} key={t.address} className="kf-lb-card">
                  <div className="kf-lb-top">
                    <span className="kf-rank">{i + 1}<sup>{ordinal(i + 1)}</sup></span>
                    <span className="kf-ava" style={{ width: 34, height: 34, ...(logoSrc(t) ? {} : { background: avaBg(t.address) }) }}>
                      {logoSrc(t) ? <img src={logoSrc(t)!} alt="" /> : <span style={{ fontSize: 14 }}>{(t.symbol || "?")[0].toUpperCase()}</span>}
                    </span>
                    <span className="kf-lb-name">${t.symbol}</span>
                    <span className="kf-lb-chip">{FEATHER}</span>
                  </div>
                  <div className="kf-lb-stats">
                    <div className="kf-stat"><div className="k">Market Cap</div><div className="v">{fmtUsd(t.marketCapUsd)}</div></div>
                    <div className="kf-stat"><div className="k">{r ? "Earns" : "Volume"}</div><div className="v">{r ?? fmtUsd(volUsd(t))}</div></div>
                    <div className="kf-stat chg"><div className="k">24h</div><div className={`v ${has ? (chg! >= 0 ? "up" : "down") : ""}`}>{has ? `${chg! >= 0 ? "+" : ""}${chg!.toFixed(2)}%` : "—"}</div></div>
                  </div>
                  <div className="kf-buy-row">
                    {[10, 25, 50, 100].map((a) => (
                      <button key={a} className="kf-buy-btn" onClick={(e) => { e.preventDefault(); nav(`/token/${t.address}?buy=${a}`); }}>${a}</button>
                    ))}
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </section>

      {/* Section head + reward filter */}
      <div className="kf-sec-head">
        <h1 className="kf-sec-title">Pools</h1>
        <div className={`kf-drop ${dropOpen ? "open" : ""}`}>
          <button className="kf-drop-btn" aria-haspopup="true" aria-expanded={dropOpen} onClick={(e) => { e.stopPropagation(); setDropOpen((o) => !o); }}>
            {filter ?? "All"}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m6 9 6 6 6-6" /></svg>
          </button>
          {dropOpen && (
            <div className="kf-drop-menu" role="menu" onClick={(e) => e.stopPropagation()}>
              <button className={filter === null ? "on" : ""} onClick={() => { setFilter(null); setDropOpen(false); }}>All</button>
              {rewards.map((r) => (
                <button key={r} className={filter === r ? "on" : ""} onClick={() => { setFilter(r); setDropOpen(false); }}>Earns {r}</button>
              ))}
            </div>
          )}
        </div>
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
            {filter ? `No coin earns ${filter} yet. ` : debounced ? "No match. " : "No coins launched yet. "}
            <Link to="/launch">Launch the first one</Link>.
          </div>
        ) : (
          feed.map((t) => {
            const r = rewardOf(t);
            const chg = t.priceChange24hPct;
            const has = chg != null && isFinite(chg);
            const hot = has && chg! >= 20;
            const official = isOfficial(t.address);
            return (
              <Link to={`/token/${t.address}`} key={t.address} className="kf-pool">
                <Avatar t={t} />
                <span className="kf-pool-mid">
                  <span className="kf-pool-name-row">
                    <span className="kf-pool-name">{t.name}</span>
                    {(hot || official) && <span className="kf-flags">{hot && FIRE}{official && CUP}</span>}
                  </span>
                  <span className="kf-pool-sub">
                    {r ? <span className="kf-status open" title={`Holders earn ${r}`}>{r}</span> : null}
                    <span className="kf-tk">${t.symbol}</span>
                    <span className="kf-vol">· {fmtUsd(volUsd(t))} vol</span>
                  </span>
                </span>
                <span className="kf-pool-right">
                  <span className="kf-pool-mc">{fmtUsd(t.marketCapUsd)}</span>
                  <span className={`kf-pool-chg ${has ? (chg! >= 0 ? "up" : "down") : ""}`}>
                    {has ? (chg! >= 0 ? UP_TRI : DN_TRI) : null}{has ? `${chg! >= 0 ? "+" : ""}${chg!.toFixed(2)}%` : "new"}
                  </span>
                </span>
                <button className="kf-bolt" aria-label={`Trade ${t.symbol}`} onClick={(e) => { e.preventDefault(); nav(`/token/${t.address}`); }}>{BOLT}</button>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
