import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTokens } from "@launchpad/sdk/react";
import type { TokenSummary } from "@launchpad/sdk";

import { Icon } from "../components/Icon";
import { TokenCard } from "../components/TokenCard";
import { Skeleton } from "../components/ui";
import { client } from "../lib/client";
import { env } from "../lib/env";
import { fmtPct, fmtUsd } from "../lib/format";
import { isHidden } from "../lib/hiddenTokens";

export function Explore() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const { data: byVolume, loading: loadingVolume } = useTokens(client, { sort: "volume", limit: 50 });
  const { data: byNew, loading: loadingNew } = useTokens(client, { sort: "new", limit: 50 });

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query.trim().toLowerCase()), 150);
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
  const results = useMemo(
    () =>
      q
        ? all.filter(
            (t) =>
              t.name.toLowerCase().includes(q) ||
              t.symbol.toLowerCase().includes(q) ||
              t.address.toLowerCase() === q,
          )
        : [],
    [all, q],
  );

  const trending = useMemo(
    () => [...all].sort((a, b) => Number(b.volume24hWei) - Number(a.volume24hWei)).slice(0, 8),
    [all],
  );
  const fresh = useMemo(() => [...all].sort((a, b) => b.createdAt - a.createdAt).slice(0, 8), [all]);
  const active = useMemo(
    () =>
      [...all]
        .filter((t) => t.txCount24h > 0)
        .sort((a, b) => b.txCount24h - a.txCount24h)
        .slice(0, 6),
    [all],
  );

  const loading = !hidden && (loadingVolume || loadingNew);
  const empty = !loading && all.length === 0;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-2 sm:px-6">
      {/* Search */}
      <label className="relative mx-auto block max-w-2xl">
        <span className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-ink-3">
          <Icon name="search" size={20} />
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tokens"
          type="search"
          className="h-[58px] w-full rounded-full border border-edge bg-panel pl-14 pr-5 text-[16px] text-ink shadow-[var(--shadow-card)] outline-none transition-colors placeholder:text-ink-3 focus:border-ink"
        />
      </label>

      {loading ? (
        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-52 rounded-[26px]" />
          ))}
        </div>
      ) : empty ? (
        <p className="mt-24 text-center text-[15px] text-ink-2">No tokens yet. Launch the first one.</p>
      ) : q ? (
        <section className="mt-10">
          <SectionHead title={`Results`} sub={`${results.length} match${results.length === 1 ? "" : "es"}`} />
          {results.length === 0 ? (
            <p className="mt-8 text-center text-[15px] text-ink-2">No tokens match your search.</p>
          ) : (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {results.map((t) => (
                <TokenCard key={t.address} token={t} />
              ))}
            </div>
          )}
        </section>
      ) : (
        <>
          {/* Trending — horizontal rail */}
          {trending.length > 0 ? (
            <section className="mt-10">
              <SectionHead title="Trending" sub="Most traded right now" />
              <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
                {trending.map((t) => (
                  <div key={t.address} className="w-[290px] shrink-0 snap-start sm:w-[320px]">
                    <TokenCard token={t} />
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {/* New Launches — grid */}
          {fresh.length > 0 ? (
            <section className="mt-12">
              <SectionHead title="New Launches" sub="Fresh markets, just opened" />
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {fresh.map((t) => (
                  <TokenCard key={t.address} token={t} />
                ))}
              </div>
            </section>
          ) : null}

          {/* Recently Active — compact list */}
          {active.length > 0 ? (
            <section className="mt-12">
              <SectionHead title="Recently Active" sub="Where the trades are landing" />
              <div className="overflow-hidden rounded-[26px] border border-edge bg-panel shadow-[var(--shadow-card)]">
                {active.map((t) => (
                  <ActiveRow key={t.address} token={t} />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function SectionHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-3">
      <h2 className="text-[22px] font-semibold tracking-tight text-ink">{title}</h2>
      <span className="text-[13px] text-ink-3">{sub}</span>
    </div>
  );
}

function ActiveRow({ token }: { token: TokenSummary }) {
  const logo = token.metadata?.logo;
  const ok = logo && /^(https?:|ipfs:|data:)/.test(String(logo));
  const src = ok
    ? String(logo).startsWith("ipfs://")
      ? `https://ipfs.io/ipfs/${String(logo).slice(7)}`
      : String(logo)
    : null;
  const change = token.priceChange24hPct;
  return (
    <Link
      to={`/token/${token.address}`}
      className="flex items-center gap-3.5 border-b border-edge px-4 py-3.5 transition-colors last:border-0 hover:bg-panel-2 sm:px-5"
    >
      <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-2xl bg-panel-2 text-xs font-bold text-ink-3">
        {src ? (
          <img src={src} alt="" loading="lazy" className="h-full w-full object-cover"
            onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
        ) : (
          token.symbol.slice(0, 3).toUpperCase()
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold text-ink">{token.name}</p>
        <p className="tnum text-[12px] text-ink-3">${token.symbol}</p>
      </div>
      <div className="text-right">
        <p className="tnum text-[15px] font-semibold text-ink">{fmtUsd(token.marketCapUsd)}</p>
        <p
          className={`tnum text-[12px] font-medium ${
            change == null ? "text-ink-3" : change >= 0 ? "text-up" : "text-down"
          }`}
        >
          {change == null ? "—" : fmtPct(change)}
        </p>
      </div>
    </Link>
  );
}
