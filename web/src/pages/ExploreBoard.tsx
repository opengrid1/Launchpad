import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTokens } from "@launchpad/sdk/react";
import type { TokenSummary } from "@launchpad/sdk";

import { QuiverMark } from "../components/QuiverMark";
import { client } from "../lib/client";
import { env } from "../lib/env";
import { fmtUsd, timeAgo, usdRateOf } from "../lib/format";
import { isHidden } from "../lib/hiddenTokens";
import { isOfficial } from "../lib/official";
import { OFFICIAL_LOGOS } from "../lib/officialLogos";

type Sort = "new" | "volume" | "mcap";
const SORTS: { id: Sort; label: string }[] = [
  { id: "new", label: "New" },
  { id: "volume", label: "Volume" },
  { id: "mcap", label: "Mcap" },
];

/**
 * Minimalist market terminal. One headline, one accent, then a single clean
 * list of markets separated by hairlines. No cards, no boxes, no marquee.
 */
export function ExploreBoard() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sort, setSort] = useState<Sort>("new");
  const { data: byVolume, loading: lv } = useTokens(client, { sort: "volume", limit: 80 });
  const { data: byNew, loading: ln } = useTokens(client, { sort: "new", limit: 80 });

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query.trim().toLowerCase()), 130);
    return () => window.clearTimeout(id);
  }, [query]);

  const all = useMemo(() => {
    if (env.hideTokens) return [] as TokenSummary[];
    const seen = new Map<string, TokenSummary>();
    for (const t of [...(byVolume ?? []), ...(byNew ?? [])]) {
      if (!isHidden(t.address)) seen.set(t.address.toLowerCase(), t);
    }
    return [...seen.values()];
  }, [byVolume, byNew]);

  const feed = useMemo(() => {
    let list = all;
    if (debounced) {
      list = all.filter(
        (t) =>
          t.name.toLowerCase().includes(debounced) ||
          t.symbol.toLowerCase().includes(debounced) ||
          t.address.toLowerCase() === debounced,
      );
    }
    const s = [...list];
    if (sort === "volume") s.sort((a, b) => Number(b.volumeTotalWei) - Number(a.volumeTotalWei));
    else if (sort === "mcap") s.sort((a, b) => Number(b.marketCapUsd) - Number(a.marketCapUsd));
    else s.sort((a, b) => b.createdAt - a.createdAt);
    return s;
  }, [all, debounced, sort]);

  const loading = !env.hideTokens && (lv || ln) && all.length === 0;
  const dayVolumeUsd = useMemo(
    () => all.reduce((a, t) => a + (Number(t.volume24hWei || "0") / 1e18) * usdRateOf(t), 0),
    [all],
  );
  const latest = useMemo(() => [...all].sort((a, b) => b.createdAt - a.createdAt)[0], [all]);

  return (
    <div className="cpm">
      <span className="cpm-blob b1" aria-hidden />
      <span className="cpm-blob b2" aria-hidden />
      {/* Broker-desk board: stat cells, then the listings in a dashed frame.
          All flywheel analytics live on /flywheel. */}
      <div className="term-stats">
        <div className="term-stat"><i>Markets</i><b>{all.length}</b></div>
        <div className="term-stat"><i>24h volume</i><b>{fmtUsd(dayVolumeUsd)}</b></div>
        <div className="term-stat"><i>Latest listing</i><b>{latest ? `$${latest.symbol}` : "–"}</b></div>
      </div>
      <section className="cpm-list term-panel" style={{ marginTop: 14 }}>
        <div className="term-head">
          The board
          <span className="term-head-sub">{feed.length} listings</span>
        </div>
        <div className="term-body">
        <div className="cpm-toolbar">
          <div className="cpm-tabs">
            {SORTS.map((s) => (
              <button key={s.id} onClick={() => setSort(s.id)} className={sort === s.id ? "on" : ""}>
                {s.label}
              </button>
            ))}
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="> search"
            type="search"
            className="cpm-search"
          />
        </div>

        {loading ? (
          <div className="cpm-grid">{[...Array(8)].map((_, i) => <div key={i} className="cpm-skel" />)}</div>
        ) : feed.length === 0 ? (
          <div className="cpm-empty">
            {debounced ? (
              <>No market for &ldquo;{debounced}&rdquo;.</>
            ) : (
              <>
                The board is clean. <Link to="/launch" className="cpm-link">Pull the first job</Link>
              </>
            )}
          </div>
        ) : (
          <div className="cpm-grid">
            {feed.map((t) => <Tile key={t.address} t={t} />)}
          </div>
        )}
        </div>
      </section>
    </div>
  );
}

function logoSrc(t: TokenSummary): string | null {
  const logo = OFFICIAL_LOGOS[t.address.toLowerCase()] ?? t.metadata?.logo;
  if (!logo || !/^(https?:|ipfs:|data:)/.test(String(logo))) return null;
  return String(logo).startsWith("ipfs://") ? `https://ipfs.io/ipfs/${String(logo).slice(7)}` : String(logo);
}

function Tile({ t }: { t: TokenSummary }) {
  const [bad, setBad] = useState(false);
  const src = logoSrc(t);
  const chg = t.priceChange24hPct;
  const hasChg = chg != null && Number.isFinite(chg) && chg !== 0;
  const volUsd = (Number(t.volume24hWei || "0") / 1e18) * usdRateOf(t);
  return (
    <Link to={`/token/${t.address}`} className="cpt">
      <span className="lg">
        {src && !bad ? <img src={src} alt="" loading="lazy" onError={() => setBad(true)} /> : <QuiverMark />}
      </span>
      <span className="id">
        <b>{t.name}</b>
        <span className="sym">
          ${t.symbol}
          {isOfficial(t.address) && <em className="off">OFFICIAL</em>}
        </span>
      </span>
      <span className="col vol">
        <i>24h vol</i>
        <span>{fmtUsd(volUsd)}</span>
      </span>
      <span className="col hold">
        <i>Holders</i>
        <span>{t.holderCount > 0 ? t.holderCount : "new"}</span>
      </span>
      <span className="col age">
        <i>Age</i>
        <span>{timeAgo(t.createdAt).replace(" ago", "")}</span>
      </span>
      {hasChg ? (
        <span className={`chg ${chg >= 0 ? "up" : "dn"}`}>
          {chg >= 0 ? "+" : ""}
          {Math.abs(chg) >= 100 ? Math.round(chg) : chg.toFixed(1)}%
        </span>
      ) : (
        <span className="chg none">–</span>
      )}
      <span className="col mcap">
        <i>Mcap</i>
        <span className="mc">{fmtUsd(t.marketCapUsd)}</span>
      </span>
    </Link>
  );
}
