import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTokens } from "@launchpad/sdk/react";
import type { TokenSummary } from "@launchpad/sdk";

import { Icon } from "../components/Icon";
import { QuiverMark } from "../components/QuiverMark";
import { client } from "../lib/client";
import { env } from "../lib/env";
import { fmtNative, fmtUsd, shortAddr, timeAgo } from "../lib/format";
import { isHidden } from "../lib/hiddenTokens";
import { OFFICIAL_LOGOS } from "../lib/officialLogos";

type Sort = "new" | "volume" | "mcap";
const SORTS: { id: Sort; label: string }[] = [
  { id: "new", label: "Newest" },
  { id: "volume", label: "Volume" },
  { id: "mcap", label: "Market cap" },
];

/**
 * Pump.fun-style live board layout, used for the Robinhood-chain brand. A
 * scrolling activity ticker of the latest launches, a spotlight on the newest
 * token, then a dense, glowing grid that flows newest-first. Distinct layout,
 * not a recolor of the default Explore.
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

  const newest = useMemo(() => [...all].sort((a, b) => b.createdAt - a.createdAt).slice(0, 14), [all]);
  const dayVolume = useMemo(() => all.reduce((a, t) => a + BigInt(t.volume24hWei || "0"), 0n), [all]);
  const loading = !env.hideTokens && (lv || ln) && all.length === 0;
  const spotlight = newest[0];

  return (
    <div className="board mx-auto max-w-6xl px-3 pb-24 pt-3 sm:px-5">
      {/* Live activity ticker */}
      {newest.length > 0 && <Ticker tokens={newest} />}

      {/* Stats strip */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <BoardStat label="Markets" value={String(all.length)} live />
        <BoardStat label="24h volume" value={fmtNative(dayVolume, 2)} />
        <BoardStat label="Latest" value={spotlight ? `$${spotlight.symbol}` : "—"} accent />
      </div>

      {/* Spotlight on the newest launch */}
      {spotlight && !debounced && <Spotlight t={spotlight} />}

      {/* Search + sort */}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative block sm:w-72">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3">
            <Icon name="search" size={15} />
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, ticker or address"
            type="search"
            className="board-input h-9 w-full pl-9 pr-3 text-[13px] outline-none"
          />
        </label>
        <div className="board-tabs">
          {SORTS.map((s) => (
            <button key={s.id} onClick={() => setSort(s.id)} className={sort === s.id ? "on" : ""}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Section label */}
      {!loading && feed.length > 0 && (
        <div className="mt-4 flex items-center gap-2">
          <span className="board-dot" />
          <h2 className="text-[12px] font-bold uppercase tracking-wide text-ink-2">
            {debounced ? "Results" : sort === "new" ? "Fresh launches" : sort === "volume" ? "Most traded" : "Top market cap"}
          </h2>
          <span className="board-hair" />
        </div>
      )}

      {/* Board grid */}
      <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
        {loading
          ? [...Array(8)].map((_, i) => <BoardSkeleton key={i} />)
          : feed.length === 0
            ? null
            : feed.map((t, i) => <BoardCard key={t.address} t={t} fresh={i < 4 && sort === "new" && !debounced} />)}
      </div>

      {!loading && feed.length === 0 && <BoardEmpty q={debounced} />}
    </div>
  );
}

function BoardStat({ label, value, live, accent }: { label: string; value: string; live?: boolean; accent?: boolean }) {
  return (
    <div className="board-stat">
      <div className="flex items-center gap-1.5">
        {live && <span className="board-dot" />}
        <span className="text-[9.5px] uppercase tracking-wide text-ink-3">{label}</span>
      </div>
      <p className={`mono mt-0.5 truncate text-[16px] font-extrabold leading-tight ${accent ? "text-accent-ink" : "text-ink"}`}>
        {value}
      </p>
    </div>
  );
}

function logoSrc(t: TokenSummary): string | null {
  const logo = OFFICIAL_LOGOS[t.address.toLowerCase()] ?? t.metadata?.logo;
  if (!logo || !/^(https?:|ipfs:|data:)/.test(String(logo))) return null;
  return String(logo).startsWith("ipfs://") ? `https://ipfs.io/ipfs/${String(logo).slice(7)}` : String(logo);
}

function Ticker({ tokens }: { tokens: TokenSummary[] }) {
  // Duplicate the list so the marquee loops seamlessly.
  const row = [...tokens, ...tokens];
  return (
    <div className="board-ticker">
      <span className="board-ticker-label">JUST LAUNCHED</span>
      <div className="board-ticker-track">
        <div className="board-ticker-run">
          {row.map((t, i) => (
            <Link key={t.address + i} to={`/token/${t.address}`} className="board-ticker-item">
              <TickerLogo t={t} />
              <span className="font-bold text-ink">{t.symbol}</span>
              <span className="mono text-accent-ink">{fmtUsd(t.marketCapUsd)}</span>
              <span className="text-ink-3">{timeAgo(t.createdAt).replace(" ago", "")}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function TickerLogo({ t }: { t: TokenSummary }) {
  const [bad, setBad] = useState(false);
  const src = logoSrc(t);
  return (
    <span className="grid h-5 w-5 place-items-center overflow-hidden rounded-full bg-panel-2">
      {src && !bad ? (
        <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" onError={() => setBad(true)} />
      ) : (
        <QuiverMark />
      )}
    </span>
  );
}

function Spotlight({ t }: { t: TokenSummary }) {
  const [bad, setBad] = useState(false);
  const src = logoSrc(t);
  const age = timeAgo(t.createdAt).replace(" ago", "");
  return (
    <Link to={`/token/${t.address}`} className="board-spotlight mt-4">
      <div className="board-spotlight-glow" />
      <div className="relative flex items-center gap-4">
        <span className="board-spotlight-art">
          {src && !bad ? (
            <img src={src} alt="" className="h-full w-full object-cover" onError={() => setBad(true)} />
          ) : (
            <QuiverMark />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="board-fresh">NEW</span>
            <span className="text-[11px] text-ink-3">{age}</span>
          </div>
          <p className="mt-1 truncate text-[18px] font-extrabold leading-tight text-ink">
            {t.name} <span className="mono text-accent-ink">${t.symbol}</span>
          </p>
          <p className="mono mt-0.5 truncate text-[11px] text-ink-3">by {shortAddr(t.creator)}</p>
        </div>
        <div className="hidden text-right sm:block">
          <p className="text-[9.5px] uppercase tracking-wide text-ink-3">Market cap</p>
          <p className="mono text-[20px] font-extrabold leading-tight text-accent-ink">{fmtUsd(t.marketCapUsd)}</p>
          <p className="mono mt-0.5 text-[11px] text-ink-2">{fmtNative(t.volumeTotalWei, 2)} vol</p>
        </div>
      </div>
    </Link>
  );
}

function BoardCard({ t, fresh }: { t: TokenSummary; fresh?: boolean }) {
  const [bad, setBad] = useState(false);
  const src = logoSrc(t);
  const age = timeAgo(t.createdAt).replace(" ago", "");
  return (
    <Link to={`/token/${t.address}`} className={`board-card ${fresh ? "is-fresh" : ""}`}>
      <div className="relative aspect-square w-full overflow-hidden bg-panel-2">
        {src && !bad ? (
          <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" onError={() => setBad(true)} />
        ) : (
          <QuiverMark />
        )}
        <span className="board-age">{age}</span>
        {fresh && <span className="board-fresh board-fresh-abs">NEW</span>}
      </div>
      <div className="p-2.5">
        <div className="flex items-baseline gap-1.5">
          <p className="min-w-0 truncate text-[12.5px] font-bold leading-tight text-ink">{t.name}</p>
          <span className="mono shrink-0 text-[10.5px] font-semibold text-accent-ink">${t.symbol}</span>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[9px] uppercase tracking-wide text-ink-3">MC</span>
          <span className="mono text-[13.5px] font-extrabold text-accent-ink">{fmtUsd(t.marketCapUsd)}</span>
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-[9px] uppercase tracking-wide text-ink-3">Vol</span>
          <span className="mono text-[11px] font-semibold text-ink-2">{fmtNative(t.volumeTotalWei, 2)}</span>
        </div>
      </div>
    </Link>
  );
}

function BoardSkeleton() {
  return (
    <div className="board-card">
      <div className="aspect-square w-full animate-pulse bg-panel-2" />
      <div className="space-y-2 p-2.5">
        <div className="h-3 w-16 animate-pulse rounded bg-panel-2" />
        <div className="h-4 w-20 animate-pulse rounded bg-panel-2" />
      </div>
    </div>
  );
}

function BoardEmpty({ q }: { q: string }) {
  return (
    <div className="flex flex-col items-center px-6 py-20 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-full bg-accent/10 text-accent-ink">
        <Icon name={q ? "search" : "launch"} size={26} />
      </span>
      <p className="mt-4 text-[18px] font-extrabold text-ink">
        {q ? `No token for "${q}"` : "No launches yet"}
      </p>
      <p className="mt-1.5 max-w-sm text-[13.5px] leading-relaxed text-ink-2">
        {q ? "Try another name, ticker or address." : "Be the first to launch. Holders earn 80% of every trade fee in the paired token, forever."}
      </p>
      {!q && (
        <Link to="/launch" className="board-launch mt-5 !px-5 !py-2.5 !text-[14px]">
          Launch the first token
        </Link>
      )}
    </div>
  );
}
