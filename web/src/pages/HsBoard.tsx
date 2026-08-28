import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTokens } from "@launchpad/sdk/react";
import type { TokenSummary } from "@launchpad/sdk";

import { WHYPE, stockByAddress } from "../lib/hyper/stocks";
import { client } from "../lib/client";
import { env } from "../lib/env";
import { fmtUsd, timeAgo } from "../lib/format";
import { isHidden, isImpersonator } from "../lib/hiddenTokens";
import { isOfficial } from "../lib/official";
import { OFFICIAL_LOGOS } from "../lib/officialLogos";
import { volUsd } from "../components/market/util";
import { KoiIcon } from "../components/base/KoiIcon";
import { HyperMark } from "../components/HyperMark";
import { DEFAULT_TOKEN_LOGO } from "../lib/hyper/defaultLogo";
import { INK_PREVIEW, PREVIEW_ON } from "../lib/base/preview";
import { ensureSdkWallet, errorText, useWallet } from "../lib/useWallet";
import { useUi } from "../store";

/** Quick-buy sizes in the chain's native token; the bolt fires a real buy. */
const QUICK_BUY_AMOUNTS = env.nativeSymbol === "ETH" ? [0.005, 0.01, 0.05, 0.1] : [1, 5, 10, 25];

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
      const hash = await (client as any).buyToken(token, BigInt(Math.round(amt * 1e18)), 0n);
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


type Tab = "pulse" | "new" | "surge" | "top";
const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "pulse", label: "Pulse", icon: <KoiIcon name="zap" size={14} /> },
  { id: "new", label: "New", icon: <KoiIcon name="clock" size={14} /> },
  { id: "surge", label: "Surge", icon: <KoiIcon name="trending-up" size={14} /> },
  { id: "top", label: "Top", icon: <KoiIcon name="trophy" size={14} /> },
];

// Design-preview fixtures live in lib/base/preview (shared with Analytics).

const pairSymbolOf = (t: TokenSummary): string => {
  const meta = t.metadata as any;
  const addr = meta?.pairAddress as string | undefined;
  if (addr) {
    if (addr.toLowerCase() === WHYPE.toLowerCase()) return env.nativeSymbol;
    const st = stockByAddress(addr);
    if (st) return st.ticker;
  }
  const p = meta?.pair as string | undefined;
  if (p) return /^w?hype$/i.test(p) ? env.nativeSymbol : p;
  return env.nativeSymbol;
};

function logoSrc(t: TokenSummary): string | null {
  const logo = OFFICIAL_LOGOS[t.address?.toLowerCase()] ?? t.metadata?.logo;
  if (!logo || !/^(https?:|ipfs:|data:)/.test(String(logo))) return null;
  return String(logo).startsWith("ipfs://") ? `https://ipfs.io/ipfs/${String(logo).slice(7)}` : String(logo);
}

function Avatar({ t }: { t: TokenSummary }) {
  const [failed, setFailed] = useState(false);
  const src = (failed ? null : logoSrc(t)) ?? DEFAULT_TOKEN_LOGO;
  return (
    <span className="gm-ava">
      <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
      <span className="gm-ava-badge"><HyperMark /></span>
    </span>
  );
}

/**
 * squidpad markets — a mobile-first card grid: filter pills over a fluid grid
 * of coin cards (logo banner, pair + 24h badges, mcap, sparkline, one-tap
 * buy). Two per row on phones, widening as the screen grows.
 */
export function HsBoard() {
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get("tab") as Tab) || "pulse";
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  const { data: byVolume, loading: lv } = useTokens(client, { sort: "volume", limit: 100 });
  const { data: byNew, loading: ln } = useTokens(client, { sort: "new", limit: 100 });

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query.trim().toLowerCase()), 130);
    return () => window.clearTimeout(id);
  }, [query]);

  const setTab = (id: Tab) => {
    const n = new URLSearchParams(sp);
    if (id === "pulse") n.delete("tab"); else n.set("tab", id);
    setSp(n, { replace: true });
  };

  const all = useMemo(() => {
    if (env.hideTokens) return [] as TokenSummary[];
    const seen = new Map<string, TokenSummary>();
    for (const t of [...(byVolume ?? []), ...(byNew ?? [])]) {
      if (!isHidden(t.address) && !isImpersonator(t)) seen.set(t.address.toLowerCase(), t);
    }
    const live = [...seen.values()];
    return live.length === 0 && PREVIEW_ON ? INK_PREVIEW : live;
  }, [byVolume, byNew]);

  const feed = useMemo(() => {
    let list = all;
    if (debounced) list = list.filter((t) => t.name.toLowerCase().includes(debounced) || t.symbol.toLowerCase().includes(debounced) || t.address.toLowerCase() === debounced);
    const s = [...list];
    if (tab === "new") s.sort((a, b) => b.createdAt - a.createdAt);
    else if (tab === "surge") s.sort((a, b) => (b.priceChange24hPct ?? -999) - (a.priceChange24hPct ?? -999) || volUsd(b) - volUsd(a));
    else if (tab === "top") s.sort((a, b) => Number(b.marketCapUsd) - Number(a.marketCapUsd));
    else s.sort((a, b) => (b.txCount24h ?? 0) - (a.txCount24h ?? 0) || b.createdAt - a.createdAt); // pulse: live activity
    return s;
  }, [all, debounced, tab]);

  const loading = !env.hideTokens && (lv || ln) && all.length === 0;

  return (
    <div className="gm-page">
      {/* Icon filter pills + expanding search, GMGN style */}
      <div className="gm-bar">
        {TABS.map((t) => (
          <button key={t.id} className={`gm-pill ${tab === t.id ? "on" : ""}`} onClick={() => setTab(t.id)}>
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
        <span className="gm-sp" />
        {searchOpen ? (
          <label className="gm-search">
            <KoiIcon name="search" size={14} />
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, ticker, CA" type="search"
              onBlur={() => { if (!query) setSearchOpen(false); }} />
          </label>
        ) : (
          <button className="gm-pill icon" aria-label="Search" onClick={() => setSearchOpen(true)}>
            <KoiIcon name="search" size={15} />
          </button>
        )}
      </div>

      {/* Mobile-first card grid: 2 up on phones, more as the screen grows */}
      <div className="sq-grid">
        {loading ? (
          [...Array(8)].map((_, i) => <div key={i} className="sq-cskel" />)
        ) : feed.length === 0 ? (
          <div className="sq-empty">
            {debounced ? "No coin matches that." : "No coins in the water yet."} <Link to="/launch">Launch the first one</Link>.
          </div>
        ) : (
          feed.map((t) => <CoinCard key={t.address} t={t} />)
        )}
      </div>
    </div>
  );
}

/** One coin as a card: logo banner with pair + change badges, name/mcap, a
 *  sparkline, and a one-tap Buy. Mobile-first; the grid packs two per row on
 *  phones and widens on desktop. */
function CoinCard({ t }: { t: TokenSummary }) {
  const chg = t.priceChange24hPct;
  const has = chg != null && isFinite(chg);
  const up = has && chg! >= 0;
  const official = isOfficial(t.address);
  const spark = ((t as any).sparkline as number[] | undefined) ?? [];
  const { buy, busyAmt } = useQuickBuy(t.address as `0x${string}`, t.symbol);
  const amt = QUICK_BUY_AMOUNTS[0];
  return (
    <Link to={`/token/${t.address}`} className="sq-card">
      <div className="sq-card-top">
        <Avatar t={t} />
        <span className="sq-pair">{pairSymbolOf(t)}</span>
        <span className={`sq-chg ${has ? (up ? "up" : "down") : "flat"}`}>{has ? `${up ? "+" : ""}${chg!.toFixed(1)}%` : "new"}</span>
        {official ? <span className="sq-official">OFFICIAL</span> : null}
      </div>
      <div className="sq-card-body">
        <div className="sq-l1"><b>{t.symbol}</b><span className="nm">{t.name}</span></div>
        <div className="sq-l2">
          <span>{Number(t.marketCapUsd) > 0 ? fmtUsd(t.marketCapUsd) : "—"} <i>mcap</i></span>
          <span className="age">{t.createdAt ? timeAgo(t.createdAt) : ""}</span>
        </div>
        <Spark data={spark} up={up} />
        <button
          className="sq-buy"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); buy(amt); }}
          disabled={busyAmt != null}
        >
          {busyAmt != null ? "Buying…" : `Buy ${amt}`}
        </button>
      </div>
    </Link>
  );
}

/** Tiny sparkline from a price series, normalized to the box. Flat baseline
 *  when there is no trade history yet. */
function Spark({ data, up }: { data: number[]; up: boolean }) {
  const W = 200, H = 40;
  let pts = `0,${H / 2} ${W},${H / 2}`;
  if (data.length >= 2) {
    const min = Math.min(...data), max = Math.max(...data);
    const span = max - min || 1;
    pts = data
      .map((v, i) => `${(i / (data.length - 1)) * W},${H - ((v - min) / span) * (H - 6) - 3}`)
      .join(" ");
  }
  const color = data.length >= 2 ? (up ? "var(--hs-green, #4ade80)" : "var(--hs-red, #ff7080)") : "var(--hs-rule-2)";
  return (
    <svg className="sq-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
