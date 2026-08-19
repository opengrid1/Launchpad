import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTokens } from "@launchpad/sdk/react";
import type { TokenSummary } from "@launchpad/sdk";

import { TokenLogo } from "../components/TokenLogo";
import { BASE_STOCKS, baseStockOf } from "../lib/base/stocks";
import { BASE_USDC, BASE_WETH } from "../lib/base/routes";
import { client } from "../lib/client";
import { env } from "../lib/env";
import { fmtUsd, timeAgo } from "../lib/format";
import { isHidden, isImpersonator } from "../lib/hiddenTokens";
import { isOfficial } from "../lib/official";
import { volUsd } from "../components/market/util";

type Sort = "hot" | "mcap" | "new";
const SORTS: { id: Sort; label: string }[] = [
  { id: "hot", label: "Hot" },
  { id: "mcap", label: "Top" },
  { id: "new", label: "Fresh" },
];

// A distinct hue per reward so each pairing has its own identity.
const HUE: Record<string, number> = {
  ETH: 258, USDC: 200, NVDA: 140, AAPL: 212, GOOGL: 18, META: 224,
  AMZN: 32, QQQ: 286, COIN: 226, MSTR: 190, SPY: 45,
};
const rewardLabel = (addr?: string) => {
  if (!addr) return null;
  if (addr.toLowerCase() === BASE_WETH.toLowerCase()) return "ETH";
  if (addr.toLowerCase() === BASE_USDC.toLowerCase()) return "USDC";
  const s = baseStockOf(addr);
  return s ? s.symbol : null;
};
const rewardOf = (t: TokenSummary) => rewardLabel((t.metadata as any)?.rewardStock as string | undefined);

function priceStr(usd: number): string {
  if (!isFinite(usd) || usd <= 0) return "—";
  if (usd >= 1) return `$${usd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (usd >= 0.0001) return `$${usd.toFixed(5)}`;
  return `$${usd.toExponential(1)}`;
}

/**
 * stonkpad's own identity: a gallery of "dividend cards". Each coin is a card
 * that foregrounds the one thing no other launchpad has — the real stock its
 * holders earn — tinted with that reward's own color. Not a board, not a table.
 */
export function ExploreStockBoard() {
  const [sort, setSort] = useState<Sort>("hot");
  const [reward, setReward] = useState<string | null>(null); // filter by earned asset
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const { data: byVolume, loading: lv } = useTokens(client, { sort: "volume", limit: 100 });
  const { data: byNew, loading: ln } = useTokens(client, { sort: "new", limit: 100 });

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query.trim().toLowerCase()), 130);
    return () => window.clearTimeout(id);
  }, [query]);

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
    if (reward) list = list.filter((t) => rewardOf(t) === reward);
    if (debounced) list = list.filter((t) => t.name.toLowerCase().includes(debounced) || t.symbol.toLowerCase().includes(debounced) || t.address.toLowerCase() === debounced);
    const s = [...list];
    if (sort === "mcap") s.sort((a, b) => Number(b.marketCapUsd) - Number(a.marketCapUsd));
    else if (sort === "new") s.sort((a, b) => b.createdAt - a.createdAt);
    else s.sort((a, b) => volUsd(b) - volUsd(a) || Number(b.marketCapUsd) - Number(a.marketCapUsd));
    return s;
  }, [all, reward, debounced, sort]);

  const rewardsPresent = useMemo(() => {
    const set = new Set<string>();
    all.forEach((t) => { const r = rewardOf(t); if (r) set.add(r); });
    // keep a stable, sensible order: currencies then the curated stocks.
    const order = ["ETH", "USDC", ...BASE_STOCKS.map((s) => s.symbol)];
    return order.filter((r) => set.has(r));
  }, [all]);

  const loading = !env.hideTokens && (lv || ln) && all.length === 0;

  return (
    <div className="dv">
      {/* Hero */}
      <section className="dv-hero">
        <div className="dv-hero-glow" aria-hidden />
        <p className="dv-eyebrow"><span className="dv-eyebrow-dot" /> Base · hold the coin, earn the asset</p>
        <h1 className="dv-title">Memecoins that pay you<br /><span className="dv-title-hl">real stock.</span></h1>
        <p className="dv-lede">Launch a coin against a tokenized stock, ETH or USDC. Every trade streams that asset to holders — a meme with a dividend.</p>
        <div className="dv-hero-actions">
          <Link to="/launch" className="dv-btn-primary">Launch a coin</Link>
          <a href="#board" className="dv-btn-ghost">Browse the wall</a>
        </div>
      </section>

      {/* Reward filters */}
      <div id="board" className="dv-filters">
        <button className={`dv-chip ${reward === null ? "on" : ""}`} onClick={() => setReward(null)}>All</button>
        {rewardsPresent.map((r) => (
          <button key={r} className={`dv-chip ${reward === r ? "on" : ""}`} onClick={() => setReward(reward === r ? null : r)}
            style={{ ["--h" as any]: HUE[r] ?? 210 }}>
            <span className="dv-chip-dot" /> {r}
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="dv-toolbar">
        <div className="dv-tabs">
          {SORTS.map((s) => (
            <button key={s.id} className={`dv-tab ${sort === s.id ? "on" : ""}`} onClick={() => setSort(s.id)}>{s.label}</button>
          ))}
        </div>
        <div className="dv-search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a coin" />
        </div>
      </div>

      {/* Card wall */}
      {loading ? (
        <div className="dv-grid">{[...Array(8)].map((_, i) => <div key={i} className="dv-card dv-skel" />)}</div>
      ) : feed.length === 0 ? (
        <div className="dv-empty">
          {reward ? <>No coin earns {reward} yet. </> : debounced ? <>Nothing matches. </> : <>The wall is empty. </>}
          <Link to="/launch" className="dv-link">Launch the first one</Link>.
        </div>
      ) : (
        <div className="dv-grid">
          {feed.map((t) => <DividendCard key={t.address} t={t} />)}
        </div>
      )}
    </div>
  );
}

function DividendCard({ t }: { t: TokenSummary }) {
  const reward = rewardOf(t);
  const hue = reward ? HUE[reward] ?? 210 : 210;
  const chg = t.priceChange24hPct;
  const hasChg = chg != null && isFinite(chg);
  return (
    <Link to={`/token/${t.address}`} className="dv-card" style={{ ["--h" as any]: hue }}>
      <div className="dv-card-glow" aria-hidden />
      <div className="dv-card-head">
        <TokenLogo token={t} size={46} />
        <div className="dv-card-id">
          <b>{t.name}{isOfficial(t.address) && <em className="dv-off">OFFICIAL</em>}</b>
          <span>${t.symbol} · {timeAgo(t.createdAt).replace(" ago", "")}</span>
        </div>
      </div>

      {/* The signature: what holders earn */}
      <div className="dv-earn">
        <span className="dv-earn-label">Holders earn</span>
        <span className="dv-earn-badge">{reward ?? "—"}</span>
      </div>

      <div className="dv-card-foot">
        <div className="dv-stat">
          <i>Mkt cap</i>
          <b>{fmtUsd(t.marketCapUsd)}</b>
        </div>
        <div className="dv-stat">
          <i>Price</i>
          <b>{priceStr(Number(t.priceUsd))}</b>
        </div>
        <div className={`dv-chg ${hasChg ? (chg! >= 0 ? "up" : "dn") : "flat"}`}>
          {hasChg ? `${chg! >= 0 ? "+" : ""}${chg!.toFixed(1)}%` : "—"}
        </div>
      </div>
    </Link>
  );
}
