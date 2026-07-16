import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTokens } from "@launchpad/sdk/react";
import type { TokenSummary } from "@launchpad/sdk";

import { TokenCard } from "../components/TokenCard";
import { Skeleton } from "../components/ui";
import { client } from "../lib/client";
import { env } from "../lib/env";
import { isHidden } from "../lib/hiddenTokens";

type Sort = "trending" | "new" | "top";

const sortLabels: Record<Sort, string> = {
  trending: "Trending",
  new: "New",
  top: "Top",
};

export function Explore() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sort, setSort] = useState<Sort>("trending");
  const { data: byVolume, loading: loadingVolume } = useTokens(client, { sort: "volume", limit: 50 });
  const { data: byNew, loading: loadingNew } = useTokens(client, { sort: "new", limit: 50 });

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query), 150);
    return () => window.clearTimeout(id);
  }, [query]);

  const q = debounced.trim().toLowerCase();
  const hidden = env.hideTokens;

  const all = useMemo(() => {
    if (hidden) return [] as TokenSummary[];
    const seen = new Map<string, TokenSummary>();
    for (const t of [...(byVolume ?? []), ...(byNew ?? [])]) {
      if (!isHidden(t.address)) seen.set(t.address.toLowerCase(), t);
    }
    return [...seen.values()];
  }, [byVolume, byNew, hidden]);

  const rows = useMemo(() => {
    const filtered = all.filter(
      (t) =>
        !q ||
        t.name.toLowerCase().includes(q) ||
        t.symbol.toLowerCase().includes(q) ||
        t.address.toLowerCase() === q,
    );
    const s = [...filtered];
    if (sort === "new") s.sort((a, b) => b.createdAt - a.createdAt);
    else if (sort === "top") s.sort((a, b) => Number(b.marketCapUsd) - Number(a.marketCapUsd));
    else s.sort((a, b) => Number(b.volume24hWei) - Number(a.volume24hWei));
    return s.slice(0, 60);
  }, [all, q, sort]);

  const loading = !hidden && (loadingVolume || loadingNew);

  return (
    <div className="mx-auto max-w-6xl px-4 pb-14 pt-1 sm:px-6">
      {/* Search + create */}
      <div className="flex items-center gap-3">
        <label className="relative flex-1">
          <svg
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-3"
            width="17" height="17" viewBox="0 0 16 16" fill="none" aria-hidden
          >
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tokens"
            className="h-[52px] w-full rounded-full border border-edge bg-panel pl-11 pr-4 text-[15px] text-ink shadow-[var(--shadow-card)] outline-none transition-colors placeholder:text-ink-3 focus:border-accent"
            type="search"
          />
        </label>
        <Link
          to="/launch"
          className="flex h-[52px] shrink-0 items-center gap-2 rounded-full bg-accent px-5 text-[15px] font-bold text-black shadow-[var(--shadow-card)] transition-colors hover:bg-accent-2"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span className="hidden sm:inline">Create</span>
        </Link>
      </div>

      {/* Sort pills */}
      <div className="mt-5 flex items-center gap-1.5">
        {(Object.keys(sortLabels) as Sort[]).map((key) => (
          <button
            key={key}
            onClick={() => setSort(key)}
            className={`h-9 rounded-full px-4 text-[13px] font-semibold transition-colors ${
              sort === key
                ? "bg-accent text-black"
                : "border border-edge bg-panel text-ink-2 hover:text-ink"
            }`}
          >
            {sortLabels[key]}
          </button>
        ))}
      </div>

      {/* Tinted section card */}
      <section className="mt-4 rounded-3xl border border-tint-2 bg-tint p-4 sm:p-6">
        <div className="mb-1 flex items-center gap-2.5">
          <h2 className="text-[22px] font-bold tracking-tight text-ink">{sortLabels[sort]}</h2>
          {!loading ? (
            <span className="tnum rounded-full bg-accent px-2.5 py-0.5 text-[13px] font-bold text-black">
              {rows.length}
            </span>
          ) : null}
        </div>
        <p className="mb-5 text-sm text-ink-2">
          {sort === "new"
            ? "The latest tokens to launch a live market."
            : sort === "top"
              ? "The largest markets by market cap."
              : "The most actively traded markets right now."}
        </p>

        {loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {[...Array(8)].map((_, i) => (
              <Skeleton key={i} className="h-64 rounded-2xl" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="py-16 text-center text-sm text-ink-2">
            {q ? "No tokens match your search." : "No tokens yet. Create the first one."}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {rows.map((t) => (
              <TokenCard key={t.address} token={t} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
