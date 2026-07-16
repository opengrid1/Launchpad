import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTokens } from "@launchpad/sdk/react";
import type { TokenSummary } from "@launchpad/sdk";

import { Icon } from "../components/Icon";
import { MiniChart } from "../components/MiniChart";
import { client } from "../lib/client";
import { env } from "../lib/env";
import { fmtPct, fmtUsd, fmtWeiUsd, usdRateOf } from "../lib/format";
import { isHidden } from "../lib/hiddenTokens";

type Lens = "trending" | "new" | "active";

const lenses: { id: Lens; label: string }[] = [
  { id: "trending", label: "Trending" },
  { id: "new", label: "New" },
  { id: "active", label: "Active" },
];

export function Explore() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [lens, setLens] = useState<Lens>("trending");
  const { data: byVolume, loading: lv } = useTokens(client, { sort: "volume", limit: 50 });
  const { data: byNew, loading: ln } = useTokens(client, { sort: "new", limit: 50 });

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query.trim().toLowerCase()), 140);
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

  const q = debounced;
  const feed = useMemo(() => {
    let list = all;
    if (q) {
      list = all.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.symbol.toLowerCase().includes(q) ||
          t.address.toLowerCase() === q,
      );
    } else if (lens === "new") {
      list = [...all].sort((a, b) => b.createdAt - a.createdAt);
    } else if (lens === "active") {
      list = [...all].sort((a, b) => b.txCount24h - a.txCount24h);
    } else {
      list = [...all].sort((a, b) => Number(b.volume24hWei) - Number(a.volume24hWei));
    }
    return list.slice(0, 60);
  }, [all, q, lens]);

  const loading = !hidden && (lv || ln);

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-8 sm:px-6">
      {/* Hero */}
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[30px] font-bold leading-tight tracking-tight text-ink sm:text-[38px]">
            Launch real markets.
            <br />
            <span className="text-accent-2">Holders earn stocks.</span>
          </h1>
          <p className="mt-2 max-w-md text-[15px] text-ink-2">
            Every trade rewards holders with real tokenized stocks — auto, by how much they hold.
          </p>
        </div>
        <Link
          to="/launch"
          className="shrink-0 rounded-full bg-accent px-6 py-3 text-[15px] font-bold text-white shadow-[0_10px_26px_-8px_rgba(0,200,5,0.55)] transition-all hover:scale-[1.03] hover:bg-accent-2"
        >
          Launch a token
        </Link>
      </div>

      {/* Search */}
      <label className="relative mt-8 block">
        <span className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-ink-3">
          <Icon name="search" size={20} />
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search markets by name, symbol or address"
          type="search"
          className="h-14 w-full rounded-2xl border border-edge bg-panel pl-[52px] pr-5 text-[16px] text-ink shadow-[var(--shadow-card)] outline-none transition-colors placeholder:text-ink-3 focus:border-accent/40"
        />
      </label>

      {/* Lens tabs */}
      {!q ? (
        <div className="mt-6 flex items-center gap-1.5">
          {lenses.map((l) => (
            <button
              key={l.id}
              onClick={() => setLens(l.id)}
              className={`rounded-full px-4 py-2 text-[14px] font-semibold transition-colors ${
                lens === l.id
                  ? "bg-ink text-white"
                  : "border border-edge bg-panel text-ink-2 hover:text-ink"
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-6 text-[14px] font-medium text-ink-3">
          {feed.length} market{feed.length === 1 ? "" : "s"} found
        </p>
      )}

      {/* Grid */}
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {loading ? (
          [...Array(6)].map((_, i) => <CardSkeleton key={i} />)
        ) : feed.length === 0 ? (
          <div className="col-span-full">
            <Empty q={query} />
          </div>
        ) : (
          feed.map((t) => <MarketCard key={t.address} t={t} />)
        )}
      </div>
    </div>
  );
}

function MarketCard({ t }: { t: TokenSummary }) {
  const rate = usdRateOf(t);
  const change = t.priceChange24hPct;
  const logo = t.metadata?.logo;
  const ok = logo && /^(https?:|ipfs:|data:)/.test(String(logo));
  const src = ok
    ? String(logo).startsWith("ipfs://")
      ? `https://ipfs.io/ipfs/${String(logo).slice(7)}`
      : String(logo)
    : null;

  return (
    <Link
      to={`/token/${t.address}`}
      className="group flex flex-col rounded-3xl border border-edge bg-panel p-5 shadow-[var(--shadow-card)] transition-all duration-200 hover:-translate-y-0.5 hover:border-edge-2 hover:shadow-[var(--shadow-card-hover)]"
    >
      <div className="flex items-center gap-3">
        <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl bg-panel-2 text-[13px] font-bold text-ink-3">
          {src ? (
            <img src={src} alt="" loading="lazy" className="h-full w-full object-cover"
              onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
          ) : (
            t.symbol.slice(0, 3).toUpperCase()
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-bold leading-tight tracking-tight text-ink group-hover:text-accent-2">
            {t.name}
          </p>
          <p className="truncate text-[13px] font-medium text-ink-3">${t.symbol}</p>
        </div>
        {change != null ? (
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-bold ${
              change >= 0 ? "bg-up/10 text-up" : "bg-down/10 text-down"
            }`}
          >
            {fmtPct(change)}
          </span>
        ) : null}
      </div>

      <div className="mt-4 flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-3">Market cap</p>
          <p className="tnum text-[22px] font-bold leading-tight text-ink">{fmtUsd(t.marketCapUsd)}</p>
        </div>
        <div className="opacity-90">
          <MiniChart token={t.address} width={96} height={40} />
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-edge pt-3 text-[13px]">
        <span className="text-ink-3">
          Vol <span className="tnum font-semibold text-ink-2">{fmtWeiUsd(t.volume24hWei, rate)}</span>
        </span>
        <span className="font-semibold text-accent-2 opacity-0 transition-opacity group-hover:opacity-100">
          Trade →
        </span>
      </div>
    </Link>
  );
}

function CardSkeleton() {
  return (
    <div className="rounded-3xl border border-edge bg-panel p-5 shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 animate-pulse rounded-2xl bg-panel-2" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-28 animate-pulse rounded bg-panel-2" />
          <div className="h-3 w-16 animate-pulse rounded bg-panel-2" />
        </div>
      </div>
      <div className="mt-4 h-8 w-24 animate-pulse rounded bg-panel-2" />
      <div className="mt-4 h-3 w-full animate-pulse rounded bg-panel-2" />
    </div>
  );
}

function Empty({ q }: { q: string }) {
  return (
    <div className="flex flex-col items-center py-24 text-center">
      <span className="grid h-16 w-16 place-items-center rounded-3xl bg-panel-2 text-ink-3">
        <Icon name={q ? "search" : "trending"} size={28} />
      </span>
      <p className="mt-4 text-[17px] font-bold text-ink">
        {q ? `No market for “${q}”` : "No markets yet"}
      </p>
      <p className="mt-1 text-[14px] text-ink-3">
        {q ? "Try another name, symbol or address." : "Launch the first token to open a market."}
      </p>
    </div>
  );
}
