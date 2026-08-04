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

const COPAIR_ADDR = "0xB9B9BfcABA4A1dc55724AD8958bCE3D36c104663";

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

  const dayVolumeUsd = useMemo(
    () => all.reduce((a, t) => a + (Number(t.volume24hWei || "0") / 1e18) * usdRateOf(t), 0),
    [all],
  );
  const loading = !env.hideTokens && (lv || ln) && all.length === 0;
  const latest = useMemo(() => [...all].sort((a, b) => b.createdAt - a.createdAt)[0], [all]);

  return (
    <div className="cpm">
      {/* Hero: type only. */}
      <section className="cpm-hero">
        <p className="cpm-eyebrow">{env.chainName} · pair &amp; earn</p>
        <h1 className="cpm-headline">
          Every trade.
          <br />
          <em>Holders get paid.</em>
        </h1>
        <p className="cpm-sub">
          Pair a coin with any stock, meme, or ETH. Holders earn 80% of every trade fee in the
          pair token, automatically.
        </p>
        <div className="cpm-ctas">
          <Link to="/launch" className="cpm-cta">Launch a coin</Link>
          <Link to="/docs" className="cpm-link">How it works →</Link>
        </div>
        <p className="cpm-statline">
          {all.length} markets · {fmtUsd(dayVolumeUsd)} 24h volume
          {latest ? <> · latest ${latest.symbol}</> : null}
        </p>
      </section>

      {/* Contract line */}
      <ContractLine />

      {/* Market list */}
      <section className="cpm-list">
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

        <div className="cpm-head">
          <span className="n">#</span>
          <span>Market</span>
          <span className="hide-sm">Earns</span>
          <span className="r">Mcap</span>
          <span className="r hide-sm">Volume</span>
          <span className="r hide-md">Age</span>
        </div>

        {loading ? (
          [...Array(6)].map((_, i) => <div key={i} className="cpm-row cpm-skel" />)
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
          feed.map((t, i) => <Row key={t.address} t={t} rank={i + 1} />)
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

function ContractLine() {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(COPAIR_ADDR).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="cpm-contract">
      <span className="k">$COPAIR</span>
      <span className="a">{COPAIR_ADDR}</span>
      <button onClick={copy}>{copied ? "copied" : "copy"}</button>
      <Link to={`/token/${COPAIR_ADDR}`}>trade →</Link>
    </div>
  );
}

function Row({ t, rank }: { t: TokenSummary; rank: number }) {
  const [bad, setBad] = useState(false);
  const src = logoSrc(t);
  const pairSym = pairSymOf(t);
  const vol = fmtUsd((Number(t.volumeTotalWei) / 1e18) * usdRateOf(t));
  return (
    <Link to={`/token/${t.address}`} className="cpm-row">
      <span className="n">{rank}</span>
      <span className="m">
        <span className="logo">
          {src && !bad ? <img src={src} alt="" loading="lazy" onError={() => setBad(true)} /> : <QuiverMark />}
        </span>
        <span className="nm">
          <b>{t.name}</b>
          <i>${t.symbol}{isOfficial(t.address) && <em> · official</em>}</i>
        </span>
      </span>
      <span className="hide-sm muted">{pairSym || "–"}</span>
      <span className="r acc">{fmtUsd(t.marketCapUsd)}</span>
      <span className="r hide-sm muted">{vol}</span>
      <span className="r hide-md muted">{timeAgo(t.createdAt).replace(" ago", "")}</span>
    </Link>
  );
}
