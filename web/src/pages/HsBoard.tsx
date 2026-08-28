import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTokens } from "@launchpad/sdk/react";
import type { TokenSummary } from "@launchpad/sdk";

import { WHYPE, stockByAddress } from "../lib/hyper/stocks";
import { client } from "../lib/client";
import { env } from "../lib/env";
import { isHidden, isImpersonator } from "../lib/hiddenTokens";
import { isOfficial } from "../lib/official";
import { OFFICIAL_LOGOS } from "../lib/officialLogos";
import { volUsd } from "../components/market/util";
import { HyperMark } from "../components/HyperMark";
import { DEFAULT_TOKEN_LOGO } from "../lib/hyper/defaultLogo";
import { INK_PREVIEW, PREVIEW_ON } from "../lib/base/preview";

/** Per-token USD unit price from market cap (fixed 1B supply). */
const unitPrice = (t: TokenSummary) => Number(t.marketCapUsd) / 1_000_000_000;
const fmtPrice = (p: number) => {
  if (p <= 0) return "—";
  if (p >= 1) return `$${p.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (p >= 0.01) return `$${p.toFixed(4)}`;
  return `$${Number(p.toPrecision(3))}`;
};

type Tab = "trending" | "new" | "gainers" | "stocks";
const TABS: { id: Tab; label: string }[] = [
  { id: "trending", label: "Trending" },
  { id: "new", label: "New" },
  { id: "gainers", label: "Gainers" },
  { id: "stocks", label: "Stocks" },
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
  const tab = (sp.get("tab") as Tab) || "trending";

  const { data: byVolume, loading: lv } = useTokens(client, { sort: "volume", limit: 100 });
  const { data: byNew, loading: ln } = useTokens(client, { sort: "new", limit: 100 });

  const setTab = (id: Tab) => {
    const n = new URLSearchParams(sp);
    if (id === "trending") n.delete("tab"); else n.set("tab", id);
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
    let s = [...all];
    if (tab === "new") s.sort((a, b) => b.createdAt - a.createdAt);
    else if (tab === "gainers") s.sort((a, b) => (b.priceChange24hPct ?? -999) - (a.priceChange24hPct ?? -999) || volUsd(b) - volUsd(a));
    else if (tab === "stocks") {
      // Only coins paired with a tokenized stock (not the native token).
      s = s.filter((t) => pairSymbolOf(t) !== env.nativeSymbol);
      s.sort((a, b) => Number(b.marketCapUsd) - Number(a.marketCapUsd));
    } else s.sort((a, b) => (b.txCount24h ?? 0) - (a.txCount24h ?? 0) || b.createdAt - a.createdAt); // trending: live activity
    return s;
  }, [all, tab]);

  const loading = !env.hideTokens && (lv || ln) && all.length === 0;

  return (
    <div className="gm-page">
      {/* Underline filter tabs */}
      <div className="sq-tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`sq-tab ${tab === t.id ? "on" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Clean single-column list: logo, name, sparkline, price + change */}
      <div className="sq-list">
        {loading ? (
          [...Array(8)].map((_, i) => <div key={i} className="sq-lskel" />)
        ) : feed.length === 0 ? (
          <div className="sq-empty">
            No coins in the water yet. <Link to="/launch">Launch the first one</Link>.
          </div>
        ) : (
          feed.map((t) => <CoinRow key={t.address} t={t} />)
        )}
      </div>
    </div>
  );
}

/** One coin as a list row: logo, symbol + pair + name, a sparkline, and the
 *  unit price with its 24h change. Tapping opens the coin's trading page. */
function CoinRow({ t }: { t: TokenSummary }) {
  const chg = t.priceChange24hPct;
  const has = chg != null && isFinite(chg);
  const up = has && chg! >= 0;
  const official = isOfficial(t.address);
  const spark = ((t as any).sparkline as number[] | undefined) ?? [];
  return (
    <Link to={`/token/${t.address}`} className="sq-row">
      <Avatar t={t} />
      <span className="sq-rmid">
        <span className="l1"><b>{t.symbol}</b><span className="pr">{pairSymbolOf(t)}</span>{official ? <span className="off">OFFICIAL</span> : null}</span>
        <span className="nm">{t.name}</span>
      </span>
      <Spark data={spark} up={up} />
      <span className="sq-rright">
        <span className="p">{fmtPrice(unitPrice(t))}</span>
        <span className={`c ${has ? (up ? "up" : "down") : "flat"}`}>{has ? `${up ? "+" : ""}${chg!.toFixed(1)}%` : "new"}</span>
      </span>
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
