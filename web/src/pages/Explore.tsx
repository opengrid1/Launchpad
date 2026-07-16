import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTokens } from "@launchpad/sdk/react";
import type { TokenSummary } from "@launchpad/sdk";

import { Icon } from "../components/Icon";
import { MiniChart } from "../components/MiniChart";
import { client } from "../lib/client";
import { env } from "../lib/env";
import { fmtPct, fmtUsd, fmtWeiUsd, timeAgo, usdRateOf } from "../lib/format";
import { isHidden } from "../lib/hiddenTokens";
import { stockOf } from "../lib/v4/stocks";

type Sort = "new" | "recent" | "mcap" | "oldest";

const SORTS: { id: Sort; label: string }[] = [
  { id: "new", label: "New" },
  { id: "recent", label: "Recent" },
  { id: "mcap", label: "Mcap" },
  { id: "oldest", label: "Oldest" },
];

/**
 * Discover — the market list, laid out like Stackr: a New button beside a
 * search field, a row of sort tabs, then a grid of token cards. Cream theme.
 */
export function Explore() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sort, setSort] = useState<Sort>("new");
  const { data: byVolume, loading: lv } = useTokens(client, { sort: "volume", limit: 60 });
  const { data: byNew, loading: ln } = useTokens(client, { sort: "new", limit: 60 });

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query.trim().toLowerCase()), 130);
    return () => window.clearTimeout(id);
  }, [query]);

  const hidden = env.hideTokens;
  const all = useMemo(() => {
    if (hidden) return [] as TokenSummary[];
    const seen = new Map<string, TokenSummary>();
    for (const t of [...(byVolume ?? []), ...(byNew ?? [])]) {
      if (!isHidden(t.address)) seen.set(t.address.toLowerCase(), t);
    }
    return [...seen.values()];
  }, [byVolume, byNew, hidden]);

  const feed = useMemo(() => {
    let list = all;
    const q = debounced;
    if (q) {
      list = all.filter(
        (t) => t.name.toLowerCase().includes(q) || t.symbol.toLowerCase().includes(q) || t.address.toLowerCase() === q,
      );
    }
    const s = [...list];
    if (sort === "mcap") s.sort((a, b) => Number(b.marketCapUsd) - Number(a.marketCapUsd));
    else if (sort === "recent") s.sort((a, b) => b.txCount24h - a.txCount24h || b.createdAt - a.createdAt);
    else if (sort === "oldest") s.sort((a, b) => a.createdAt - b.createdAt);
    else s.sort((a, b) => b.createdAt - a.createdAt);
    return s;
  }, [all, debounced, sort]);

  const loading = !hidden && (lv || ln) && all.length === 0;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-5 sm:px-6">
      {/* New + search */}
      <div className="flex items-center gap-3">
        <Link
          to="/launch"
          className="flex shrink-0 items-center gap-2 rounded-xl bg-accent px-4 py-3 text-[14.5px] font-semibold text-white transition-colors hover:bg-accent-2"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          New
        </Link>
        <label className="relative block flex-1">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-3">
            <Icon name="search" size={18} />
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tokens…"
            type="search"
            className="h-12 w-full rounded-xl border border-edge bg-panel pl-11 pr-4 text-[15px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-ink/30"
          />
        </label>
      </div>

      {/* Sort tabs */}
      <div className="mt-4 inline-flex items-center gap-1 rounded-xl border border-edge bg-panel p-1">
        {SORTS.map((s) => (
          <button
            key={s.id}
            onClick={() => setSort(s.id)}
            className={`rounded-lg px-4 py-1.5 text-[13.5px] font-medium transition-colors ${
              sort === s.id ? "bg-accent text-white" : "text-ink-2 hover:text-ink"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => <CardSkeleton key={i} />)}
        </div>
      ) : feed.length === 0 ? (
        <Empty q={debounced} />
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {feed.map((t) => <TokenCard key={t.address} t={t} />)}
        </div>
      )}
    </div>
  );
}

function TokenCard({ t }: { t: TokenSummary }) {
  const rate = usdRateOf(t);
  const change = t.priceChange24hPct;
  const stock = stockOf((t.metadata as any)?.rewardStock);
  const logo = t.metadata?.logo;
  const ok = logo && /^(https?:|ipfs:|data:)/.test(String(logo));
  const src = ok
    ? String(logo).startsWith("ipfs://") ? `https://ipfs.io/ipfs/${String(logo).slice(7)}` : String(logo)
    : null;

  return (
    <Link to={`/token/${t.address}`} className="card-hover block rounded-2xl border border-edge bg-panel p-4">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full border border-edge bg-panel-2 text-[13px] font-bold text-ink-3">
          {src ? (
            <img src={src} alt="" loading="lazy" className="h-full w-full object-cover"
              onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
          ) : (
            t.symbol.slice(0, 2).toUpperCase()
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15.5px] font-bold leading-tight text-ink">{t.name}</p>
          <p className="mono truncate text-[12px] text-ink-3">{t.symbol} · {timeAgo(t.createdAt)}</p>
        </div>
        <span
          className={`mono shrink-0 rounded-md px-2 py-1 text-[12px] font-semibold ${
            change == null ? "bg-panel-2 text-ink-3" : change >= 0 ? "bg-up/10 text-up" : "bg-down/10 text-down"
          }`}
        >
          {change == null ? "—" : fmtPct(change)}
        </span>
      </div>

      <div className="mt-3 h-11 overflow-hidden rounded-lg bg-panel-2/50">
        <MiniChart token={t.address} width={520} height={44} />
      </div>

      <div className="mt-3 flex items-end justify-between">
        <div>
          <p className="text-[11px] text-ink-3">Market cap</p>
          <p className="mono text-[20px] font-bold leading-tight text-ink">{fmtUsd(t.marketCapUsd)}</p>
        </div>
        {stock ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-panel-2 px-2.5 py-1 text-[12px] font-semibold text-ink-2">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            Earns {stock.symbol}
          </span>
        ) : null}
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-edge pt-2.5 text-[12px]">
        <span className="text-ink-3">Vol <span className="mono font-medium text-ink-2">{fmtWeiUsd(t.volume24hWei, rate)}</span></span>
        <span className="font-semibold text-accent-2">Trade →</span>
      </div>
    </Link>
  );
}

function CardSkeleton() {
  return (
    <div className="rounded-2xl border border-edge bg-panel p-4">
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 animate-pulse rounded-full bg-panel-2" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-28 animate-pulse rounded bg-panel-2" />
          <div className="h-3 w-16 animate-pulse rounded bg-panel-2" />
        </div>
      </div>
      <div className="mt-3 h-11 animate-pulse rounded-lg bg-panel-2" />
      <div className="mt-3 h-7 w-24 animate-pulse rounded bg-panel-2" />
    </div>
  );
}

function Empty({ q }: { q: string }) {
  return (
    <div className="flex flex-col items-center px-6 py-24 text-center">
      <span className="grid h-16 w-16 place-items-center rounded-full bg-accent/10 text-accent">
        <Icon name={q ? "search" : "launch"} size={28} />
      </span>
      <p className="mt-5 text-[19px] font-bold text-ink">
        {q ? `No token for “${q}”` : "No tokens launched yet"}
      </p>
      <p className="mt-1.5 max-w-sm text-[14.5px] leading-relaxed text-ink-2">
        {q ? "Try another name, symbol or address." : "Be the first to open a market — holders earn a real tokenized stock on every trade."}
      </p>
      {!q ? (
        <Link to="/launch" className="mt-6 flex items-center gap-2 rounded-xl bg-accent px-5 py-3 text-[14.5px] font-semibold text-white transition-colors hover:bg-accent-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Launch First Token
        </Link>
      ) : null}
    </div>
  );
}
