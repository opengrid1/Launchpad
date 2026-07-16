import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTokens } from "@launchpad/sdk/react";
import type { TokenSummary } from "@launchpad/sdk";

import { TokenLogo } from "../components/TokenLogo";
import { Skeleton } from "../components/ui";
import { BRAND } from "../lib/brand";
import { client } from "../lib/client";
import { env } from "../lib/env";
import { compact, fmtPct, fmtUsd, fmtWeiUsd, timeAgo, usdRateOf } from "../lib/format";
import { isHidden } from "../lib/hiddenTokens";

type Sort = "trending" | "new" | "top";

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

  // Master set: everything we know about, de-duped by address.
  const all = useMemo(() => {
    if (hidden) return [] as TokenSummary[];
    const seen = new Map<string, TokenSummary>();
    for (const t of [...(byVolume ?? []), ...(byNew ?? [])]) {
      if (!isHidden(t.address)) seen.set(t.address.toLowerCase(), t);
    }
    return [...seen.values()];
  }, [byVolume, byNew, hidden]);

  const rate = all[0] ? usdRateOf(all[0]) : 0;
  const stats = useMemo(() => {
    const vol = all.reduce((a, t) => a + Number(t.volume24hWei) / 1e18, 0) * rate;
    return { count: all.length, vol };
  }, [all, rate]);

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
    return s.slice(0, 50);
  }, [all, q, sort]);

  const loading = !hidden && (loadingVolume || loadingNew);

  return (
    <div className="mx-auto max-w-6xl px-4 pb-12 pt-4 sm:px-6">
      {/* Masthead */}
      <section className="flex flex-col gap-5 border-b border-edge pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent">
            Live on {env.chainName}
          </p>
          <h1 className="font-display mt-3 max-w-2xl text-[40px] font-normal leading-[1.0] tracking-[-0.005em] text-ink sm:text-[56px]">
            Launch a token into a real market in one transaction.
          </h1>
          <p className="mt-3 max-w-md text-[15px] text-ink-2">
            {BRAND.name} seeds a live Uniswap pool with the full supply. Every trade routes through
            the market, and the fee flows straight back to the people holding.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Stat label="Tokens" value={loading ? "—" : compact(stats.count)} />
          <div className="h-9 w-px bg-edge" />
          <Stat label="24h Volume" value={loading ? "—" : fmtUsd(String(stats.vol))} />
          <Link
            to="/launch"
            className="ml-2 hidden h-11 items-center rounded-full bg-accent px-5 text-sm font-semibold text-black transition-colors hover:bg-accent-2 sm:flex"
          >
            Launch
          </Link>
        </div>
      </section>

      {/* Controls: tabs + search */}
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1 rounded-full border border-edge bg-panel p-1">
          {(
            [
              ["trending", "Trending"],
              ["new", "New"],
              ["top", "Top"],
            ] as [Sort, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setSort(key)}
              className={`h-8 rounded-full px-4 text-[13px] font-semibold transition-colors ${
                sort === key ? "bg-accent text-black" : "text-ink-2 hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative sm:w-72">
          <svg
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3"
            width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden
          >
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, symbol, address"
            className="h-10 w-full rounded-full border border-edge bg-panel pl-10 pr-4 text-sm text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-accent"
            type="search"
          />
        </div>
      </div>

      {/* Screener table */}
      <div className="mt-4 overflow-x-auto rounded-2xl border border-edge bg-panel">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-edge font-mono text-[11px] uppercase tracking-wider text-ink-3">
              <th className="py-3 pl-5 pr-2 font-medium">#</th>
              <th className="px-2 py-3 font-medium">Token</th>
              <th className="px-2 py-3 text-right font-medium">Market Cap</th>
              <th className="px-2 py-3 text-right font-medium">24h</th>
              <th className="px-2 py-3 text-right font-medium">Volume 24h</th>
              <th className="hidden px-2 py-3 text-right font-medium sm:table-cell">Holders</th>
              <th className="hidden px-2 py-3 text-right font-medium sm:table-cell">Age</th>
              <th className="py-3 pl-2 pr-5"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(8)].map((_, i) => (
                <tr key={i} className="border-b border-edge/50">
                  <td colSpan={8} className="px-5 py-3">
                    <Skeleton className="h-7 rounded-lg" />
                  </td>
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-5 py-16 text-center text-sm text-ink-2">
                  {q ? "No tokens match your search." : "No tokens yet. Launch the first one."}
                </td>
              </tr>
            ) : (
              rows.map((t, i) => <Row key={t.address} t={t} rank={i + 1} rate={rate} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({ t, rank, rate }: { t: TokenSummary; rank: number; rate: number }) {
  const change = t.priceChange24hPct;
  const usdRate = rate || usdRateOf(t);
  return (
    <tr className="group border-b border-edge/50 transition-colors last:border-0 hover:bg-panel-2">
      <td className="py-3 pl-5 pr-2 font-mono text-xs text-ink-3">{rank}</td>
      <td className="px-2 py-3">
        <Link to={`/token/${t.address}`} className="flex items-center gap-3">
          <TokenLogo token={t} size={30} />
          <span className="min-w-0">
            <span className="block truncate font-semibold text-ink">{t.name}</span>
            <span className="tnum text-xs text-ink-3">${t.symbol}</span>
          </span>
        </Link>
      </td>
      <td className="tnum px-2 py-3 text-right font-semibold text-ink">{fmtUsd(t.marketCapUsd)}</td>
      <td
        className={`tnum px-2 py-3 text-right font-medium ${
          change == null ? "text-ink-3" : change >= 0 ? "text-up" : "text-down"
        }`}
      >
        {change == null ? "—" : fmtPct(change)}
      </td>
      <td className="tnum px-2 py-3 text-right text-ink-2">{fmtWeiUsd(t.volume24hWei, usdRate)}</td>
      <td className="tnum hidden px-2 py-3 text-right text-ink-2 sm:table-cell">{compact(t.holderCount)}</td>
      <td className="hidden px-2 py-3 text-right text-ink-3 sm:table-cell">{timeAgo(t.createdAt)}</td>
      <td className="py-3 pl-2 pr-5 text-right">
        <Link
          to={`/token/${t.address}`}
          className="inline-flex h-8 items-center rounded-full border border-edge-2 px-3.5 text-xs font-semibold text-ink-2 transition-colors group-hover:border-accent group-hover:text-accent"
        >
          Trade
        </Link>
      </td>
    </tr>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <p className="tnum text-[17px] font-semibold leading-none text-ink">{value}</p>
      <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">{label}</p>
    </div>
  );
}
