import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTokens } from "@launchpad/sdk/react";
import type { TokenSummary } from "@launchpad/sdk";

import { QuiverMark } from "../components/QuiverMark";
import { client } from "../lib/client";
import { env } from "../lib/env";
import { fmtUsd, timeAgo } from "../lib/format";
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

  return (
    <div className="cpm">
      <span className="cpm-blob b1" aria-hidden />
      <span className="cpm-blob b2" aria-hidden />
      {/* Pure token board: just the toolbar and the card grid. All flywheel
          analytics live on /flywheel. */}
      <section className="cpm-list" style={{ marginTop: 18 }}>
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
            placeholder="Search"
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
                No launches yet. <Link to="/launch" className="cpm-link">Be the first →</Link>
              </>
            )}
          </div>
        ) : (
          <div className="cpm-grid">
            {feed.map((t, i) => <Tile key={t.address} t={t} idx={i} />)}
          </div>
        )}
      </section>
    </div>
  );
}

function logoSrc(t: TokenSummary): string | null {
  const logo = OFFICIAL_LOGOS[t.address.toLowerCase()] ?? t.metadata?.logo;
  if (!logo || !/^(https?:|ipfs:|data:)/.test(String(logo))) return null;
  return String(logo).startsWith("ipfs://") ? `https://ipfs.io/ipfs/${String(logo).slice(7)}` : String(logo);
}

function pairSymOf(t: TokenSummary): string {
  const s = (t.metadata as any)?.pair?.symbol ?? (t.metadata as any)?.rewardStockSymbol;
  return typeof s === "string" && s ? s : "";
}

function Tile({ t, idx }: { t: TokenSummary; idx: number }) {
  const [bad, setBad] = useState(false);
  const src = logoSrc(t);
  const pairSym = pairSymOf(t);
  return (
    <Link to={`/token/${t.address}`} className={`cpt c${idx % 4}`}>
      <div className="hd">
        <span className="lg">
          {src && !bad ? <img src={src} alt="" loading="lazy" onError={() => setBad(true)} /> : <QuiverMark />}
        </span>
        <span className="id">
          <b>{t.name}</b>
          <span className="sym">${t.symbol}</span>
        </span>
        {isOfficial(t.address) && <span className="off">OFFICIAL</span>}
      </div>
      <div className="meta">
        <span className="earn">1% fee · weekly burn flywheel</span>
        {pairSym && pairSym !== "ETH" ? <span className="earn">pairs {pairSym}</span> : null}
      </div>
      <div className="figures">
        <span><i>Mcap</i><span className="mc">{fmtUsd(t.marketCapUsd)}</span></span>
        <span className="age">{timeAgo(t.createdAt).replace(" ago", "")}</span>
      </div>
    </Link>
  );
}
