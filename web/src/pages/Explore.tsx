import { useEffect, useMemo, useState } from "react";
import { useTokens } from "@launchpad/sdk/react";
import type { TokenSummary } from "@launchpad/sdk";

import { TokenCard } from "../components/TokenCard";
import { Skeleton } from "../components/ui";
import { client } from "../lib/client";
import { env } from "../lib/env";
import { isHidden } from "../lib/hiddenTokens";

export function Explore() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const { data: byVolume, loading: loadingVolume } = useTokens(client, { sort: "volume", limit: 50 });
  const { data: byNew, loading: loadingNew } = useTokens(client, { sort: "new", limit: 50 });

  // Keep the input instant while the filter work runs on a settled value, so
  // typing never re-filters the whole list on every keystroke.
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query), 150);
    return () => window.clearTimeout(id);
  }, [query]);

  const q = debounced.trim().toLowerCase();
  const matches = (t: TokenSummary) =>
    !isHidden(t.address) &&
    (!q ||
      t.name.toLowerCase().includes(q) ||
      t.symbol.toLowerCase().includes(q) ||
      t.address.toLowerCase() === q);

  // Private/pre-launch mode: the public feed shows nothing at all.
  const hidden = env.hideTokens;

  const trending = useMemo(
    () => (hidden ? [] : (byVolume ?? []).filter(matches).slice(0, 6)),
    [byVolume, q, hidden]
  );
  const trendingSet = useMemo(() => new Set(trending.map((t) => t.address)), [trending]);
  const fresh = useMemo(
    () => (hidden ? [] : (byNew ?? []).filter((t) => matches(t) && !trendingSet.has(t.address)).slice(0, 30)),
    [byNew, q, trendingSet, hidden]
  );

  const loading = !hidden && (loadingVolume || loadingNew);
  const nothing = !loading && trending.length === 0 && fresh.length === 0;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <h1 className="text-[28px] font-semibold tracking-tight text-ink">Explore</h1>

      <div className="relative mt-5">
        <svg
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-3"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden
        >
          <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tokens..."
          className="h-12 w-full rounded-full border border-edge bg-panel pl-11 pr-4 text-[15px] text-ink shadow-[var(--shadow-card)] outline-none transition-colors placeholder:text-ink-3 focus:border-ink"
          type="search"
        />
      </div>

      {loading ? (
        <div className="mt-8 space-y-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-2xl" />
          ))}
        </div>
      ) : nothing ? (
        <p className="mt-16 text-center text-sm text-ink-2">
          {q ? "No tokens match your search." : "No tokens yet. Launch the first one."}
        </p>
      ) : (
        <>
          {trending.length > 0 ? (
            <section className="mt-8">
              <h2 className="mb-3 text-[15px] font-semibold text-ink">Trending</h2>
              <div className="space-y-4">
                {trending.map((t) => (
                  <TokenCard key={t.address} token={t} />
                ))}
              </div>
            </section>
          ) : null}

          {fresh.length > 0 ? (
            <section className="mt-10 pb-4">
              <h2 className="mb-3 text-[15px] font-semibold text-ink">New Launches</h2>
              <div className="space-y-4">
                {fresh.map((t) => (
                  <TokenCard key={t.address} token={t} />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
