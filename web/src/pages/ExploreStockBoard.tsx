import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTokens } from "@launchpad/sdk/react";
import type { TokenSummary } from "@launchpad/sdk";

import { TickerTape } from "../components/base/TickerTape";
import { TokenLogo } from "../components/TokenLogo";
import { baseStockOf } from "../lib/base/stocks";
import { client } from "../lib/client";
import { env } from "../lib/env";
import { fmtUsd, timeAgo } from "../lib/format";
import { isHidden, isImpersonator } from "../lib/hiddenTokens";
import { isOfficial } from "../lib/official";
import { liqUsd, volUsd } from "../components/market/util";

type Sort = "mcap" | "vol" | "new" | "gain";
const SORTS: { id: Sort; label: string }[] = [
  { id: "mcap", label: "Mkt Cap" },
  { id: "vol", label: "Volume" },
  { id: "gain", label: "Movers" },
  { id: "new", label: "Newest" },
];

const stockOf = (t: TokenSummary) => {
  const addr = (t.metadata as any)?.rewardStock as string | undefined;
  return baseStockOf(addr);
};
const disp = (sym: string) => sym.replace(/^wt/, "").replace(/c$/, "");

function priceStr(usd: number): string {
  if (!isFinite(usd) || usd <= 0) return "—";
  if (usd >= 1) return `$${usd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (usd >= 0.0001) return `$${usd.toFixed(5)}`;
  return `$${usd.toExponential(2)}`;
}

/**
 * stonkpad "coin exchange" board — a stock-terminal identity distinct from the
 * heist board: a scrolling reward-stock ticker, a terminal masthead with live
 * market stats, and a dense green/red quotes board where every coin shows the
 * real stock its holders earn.
 */
export function ExploreStockBoard() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sort, setSort] = useState<Sort>("mcap");
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
    if (debounced) {
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(debounced) ||
          t.symbol.toLowerCase().includes(debounced) ||
          t.address.toLowerCase() === debounced,
      );
    }
    const s = [...list];
    if (sort === "mcap") s.sort((a, b) => Number(b.marketCapUsd) - Number(a.marketCapUsd));
    else if (sort === "vol") s.sort((a, b) => volUsd(b) - volUsd(a));
    else if (sort === "gain") s.sort((a, b) => (b.priceChange24hPct ?? -1e9) - (a.priceChange24hPct ?? -1e9));
    else s.sort((a, b) => b.createdAt - a.createdAt);
    return s;
  }, [all, debounced, sort]);

  const stats = useMemo(() => {
    const mcap = all.reduce((a, t) => a + Number(t.marketCapUsd || 0), 0);
    const vol = all.reduce((a, t) => a + volUsd(t), 0);
    return { count: all.length, mcap, vol };
  }, [all]);

  const loading = !env.hideTokens && (lv || ln) && all.length === 0;

  return (
    <div className="sx">
      <TickerTape />

      {/* Terminal masthead */}
      <section className="sx-head">
        <div className="sx-head-main">
          <div className="sx-live"><span className="sx-live-dot" /> LIVE · BASE</div>
          <h1 className="sx-title">The Coin Exchange</h1>
          <p className="sx-sub">Launch a coin, earn real stock. Every trade pays holders the stock it&apos;s listed against.</p>
        </div>
        <dl className="sx-stats">
          <div><dt>Listings</dt><dd>{stats.count}</dd></div>
          <div><dt>Total Mkt Cap</dt><dd>{fmtUsd(stats.mcap)}</dd></div>
          <div><dt>24h Volume</dt><dd>{fmtUsd(stats.vol)}</dd></div>
        </dl>
      </section>

      {/* Toolbar */}
      <div className="sx-toolbar">
        <div className="sx-tabs">
          {SORTS.map((s) => (
            <button key={s.id} className={`sx-tab ${sort === s.id ? "on" : ""}`} onClick={() => setSort(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
        <div className="sx-search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
            <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
          </svg>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search ticker or address" />
        </div>
        <Link to="/launch" className="sx-list-btn">List a coin +</Link>
      </div>

      {/* Quotes board */}
      <section className="sx-board" aria-label="Coin quotes">
        <div className="sx-row sx-row-head">
          <span className="sx-c-rank">#</span>
          <span className="sx-c-name">Coin</span>
          <span className="sx-c-earn">Earns</span>
          <span className="sx-c-num">Last</span>
          <span className="sx-c-num">24h</span>
          <span className="sx-c-num">Mkt Cap</span>
          <span className="sx-c-num sx-hide-sm">Volume</span>
          <span className="sx-c-num sx-hide-sm">Age</span>
        </div>

        {loading ? (
          [...Array(8)].map((_, i) => <div key={i} className="sx-row sx-skel" />)
        ) : feed.length === 0 ? (
          <div className="sx-empty">
            The board is quiet. <Link to="/launch" className="sx-link">List the first coin</Link>.
          </div>
        ) : (
          feed.map((t, i) => {
            const st = stockOf(t);
            const chg = t.priceChange24hPct;
            const hasChg = chg != null && isFinite(chg);
            return (
              <Link to={`/token/${t.address}`} key={t.address} className="sx-row">
                <span className="sx-c-rank">{i + 1}</span>
                <span className="sx-c-name">
                  <TokenLogo token={t} size={30} />
                  <span className="sx-name-txt">
                    <b>{t.symbol}{isOfficial(t.address) && <em className="sx-off">OFFICIAL</em>}</b>
                    <i>{t.name}</i>
                  </span>
                </span>
                <span className="sx-c-earn">
                  {st ? <span className="sx-earn-badge">{disp(st.symbol)}</span> : <span className="sx-earn-badge muted">—</span>}
                </span>
                <span className="sx-c-num sx-mono">{priceStr(Number(t.priceUsd))}</span>
                <span className={`sx-c-num sx-mono ${hasChg ? (chg! >= 0 ? "sx-up" : "sx-dn") : "sx-muted"}`}>
                  {hasChg ? `${chg! >= 0 ? "+" : ""}${chg!.toFixed(1)}%` : "—"}
                </span>
                <span className="sx-c-num sx-mono">{fmtUsd(t.marketCapUsd)}</span>
                <span className="sx-c-num sx-mono sx-hide-sm">{fmtUsd(volUsd(t))}</span>
                <span className="sx-c-num sx-mono sx-hide-sm">{timeAgo(t.createdAt).replace(" ago", "")}</span>
              </Link>
            );
          })
        )}
      </section>
    </div>
  );
}
