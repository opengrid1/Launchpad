import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTokens } from "@launchpad/sdk/react";
import type { TokenSummary } from "@launchpad/sdk";

import { Icon } from "../components/Icon";
import { MiniChart } from "../components/MiniChart";
import { client } from "../lib/client";
import { env } from "../lib/env";
import { compact, fmtPct, fmtSmall, fmtUsd, fmtWeiUsd, usdRateOf } from "../lib/format";
import { isHidden } from "../lib/hiddenTokens";

type Lens = "trending" | "new" | "active";
type SortKey = "marketCap" | "price" | "change" | "volume" | "liquidity" | "txns" | "holders" | "age";
type Dir = "asc" | "desc";

const lenses: { id: Lens; label: string }[] = [
  { id: "trending", label: "Trending" },
  { id: "new", label: "New" },
  { id: "active", label: "Active" },
];

export function Explore() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [lens, setLens] = useState<Lens>("trending");
  const [sort, setSort] = useState<{ key: SortKey; dir: Dir } | null>(null);
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

    if (sort) {
      const mul = sort.dir === "asc" ? 1 : -1;
      const val = (t: TokenSummary): number => {
        switch (sort.key) {
          case "marketCap": return Number(t.marketCapUsd);
          case "price": return Number(t.priceUsd);
          case "change": return t.priceChange24hPct ?? -Infinity;
          case "volume": return Number(t.volume24hWei);
          case "liquidity": return Number(t.liquidityWei);
          case "txns": return t.txCount24h;
          case "holders": return t.holderCount;
          case "age": return t.createdAt;
        }
      };
      list = [...list].sort((a, b) => (val(a) - val(b)) * mul);
    }
    return list.slice(0, 50);
  }, [all, q, lens, sort]);

  const loading = !hidden && (lv || ln);
  const ticker = useMemo(
    () => [...all].sort((a, b) => Number(b.volume24hWei) - Number(a.volume24hWei)).slice(0, 14),
    [all],
  );

  const toggleSort = (key: SortKey) =>
    setSort((s) =>
      s?.key === key ? (s.dir === "desc" ? { key, dir: "asc" } : null) : { key, dir: "desc" },
    );

  return (
    <div className="min-h-full">
      {/* Ticker strip */}
      {ticker.length > 0 ? <Ticker rows={ticker} /> : null}

      <div className="mx-auto max-w-[1400px] px-3 pb-24 pt-4 sm:px-4">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-lg border border-edge bg-panel p-0.5">
            {lenses.map((l) => (
              <button
                key={l.id}
                onClick={() => { setLens(l.id); setSort(null); }}
                className={`rounded-md px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                  lens === l.id && !q
                    ? "bg-panel-2 text-ink"
                    : "text-ink-3 hover:text-ink-2"
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>

          <label className="relative ml-auto block w-full sm:w-72">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3">
              <Icon name="search" size={16} />
            </span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name / symbol / address"
              type="search"
              className="mono h-9 w-full rounded-lg border border-edge bg-panel pl-9 pr-3 text-[12px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-edge-2"
            />
          </label>
        </div>

        {/* Table */}
        <div className="mt-3 overflow-x-auto rounded-xl border border-edge bg-panel">
          <table className="w-full min-w-[880px] border-collapse">
            <thead>
              <tr className="border-b border-edge text-[11px] uppercase tracking-wide text-ink-3">
                <Th className="pl-4 text-left">Market</Th>
                <Th sortKey="price" sort={sort} onSort={toggleSort} className="text-right">Price</Th>
                <Th sortKey="change" sort={sort} onSort={toggleSort} className="text-right">24h</Th>
                <Th sortKey="marketCap" sort={sort} onSort={toggleSort} className="text-right">MCap</Th>
                <Th sortKey="liquidity" sort={sort} onSort={toggleSort} className="hidden text-right md:table-cell">Liquidity</Th>
                <Th sortKey="volume" sort={sort} onSort={toggleSort} className="text-right">Vol 24h</Th>
                <Th sortKey="txns" sort={sort} onSort={toggleSort} className="hidden text-right lg:table-cell">Txns</Th>
                <Th sortKey="holders" sort={sort} onSort={toggleSort} className="hidden text-right lg:table-cell">Holders</Th>
                <Th className="hidden text-right xl:table-cell">Chart</Th>
                <Th className="pr-4 text-right"></Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(8)].map((_, i) => <RowSkeleton key={i} />)
              ) : feed.length === 0 ? (
                <tr>
                  <td colSpan={10}>
                    <Empty q={query} />
                  </td>
                </tr>
              ) : (
                feed.map((t, i) => <Row key={t.address} t={t} rank={i + 1} />)
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Ticker({ rows }: { rows: TokenSummary[] }) {
  const doubled = [...rows, ...rows];
  return (
    <div className="overflow-hidden border-b border-edge bg-panel">
      <div className="ticker-track flex w-max items-center whitespace-nowrap py-1.5">
        {doubled.map((t, i) => {
          const c = t.priceChange24hPct;
          return (
            <Link
              key={`${t.address}-${i}`}
              to={`/token/${t.address}`}
              className="mono flex items-center gap-2 px-4 text-[12px] transition-opacity hover:opacity-80"
            >
              <span className="font-bold text-ink">{t.symbol}</span>
              <span className="text-ink-2">{fmtUsd(Number(t.priceUsd))}</span>
              <span className={c == null ? "text-ink-3" : c >= 0 ? "text-up" : "text-down"}>
                {c == null ? "—" : fmtPct(c)}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function SortCaret({ dir }: { dir?: Dir }) {
  return (
    <svg width="8" height="10" viewBox="0 0 8 10" fill="none" aria-hidden className="shrink-0">
      <path
        d="M4 0.5 L6.5 3.2 L1.5 3.2 Z"
        fill="currentColor"
        opacity={dir === undefined ? 0.35 : dir === "asc" ? 1 : 0.25}
      />
      <path
        d="M4 9.5 L1.5 6.8 L6.5 6.8 Z"
        fill="currentColor"
        opacity={dir === undefined ? 0.35 : dir === "desc" ? 1 : 0.25}
      />
    </svg>
  );
}

function Th({
  children,
  className = "",
  sortKey,
  sort,
  onSort,
}: {
  children?: React.ReactNode;
  className?: string;
  sortKey?: SortKey;
  sort?: { key: SortKey; dir: Dir } | null;
  onSort?: (k: SortKey) => void;
}) {
  const active = sortKey && sort?.key === sortKey;
  return (
    <th className={`px-3 py-2.5 font-semibold ${className}`}>
      {sortKey ? (
        <button
          onClick={() => onSort?.(sortKey)}
          className={`inline-flex items-center gap-1 transition-colors hover:text-ink ${
            active ? "text-accent" : ""
          }`}
        >
          {children}
          <SortCaret dir={active ? sort!.dir : undefined} />
        </button>
      ) : (
        children
      )}
    </th>
  );
}

function Row({ t, rank }: { t: TokenSummary; rank: number }) {
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
    <tr className="group border-b border-edge/60 transition-colors last:border-0 hover:bg-panel-2">
      {/* Market */}
      <td className="py-2.5 pl-4 pr-3">
        <Link to={`/token/${t.address}`} className="flex items-center gap-3">
          <span className="mono w-5 shrink-0 text-right text-[11px] text-ink-3">{rank}</span>
          <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-lg bg-panel-2 text-[10px] font-bold text-ink-3 ring-1 ring-edge">
            {src ? (
              <img src={src} alt="" loading="lazy" className="h-full w-full object-cover"
                onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
            ) : (
              t.symbol.slice(0, 3).toUpperCase()
            )}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold leading-tight text-ink group-hover:text-accent">
              {t.name}
            </span>
            <span className="mono flex items-center gap-1.5 truncate text-[11px] leading-tight text-ink-3">
              ${t.symbol}
              {t.limitsActive ? (
                <span className="inline-flex items-center gap-1 rounded-sm bg-accent/15 px-1 text-[9px] font-bold uppercase tracking-wide text-accent-2">
                  <span className="pulse-dot h-1 w-1 rounded-full bg-accent-2" />
                  Live
                </span>
              ) : null}
            </span>
          </span>
        </Link>
      </td>

      {/* Price */}
      <td className="mono px-3 py-2.5 text-right text-[12px] text-ink">
        {rate > 0 ? (Number(t.priceUsd) < 0.01 ? `$${fmtSmall(Number(t.priceUsd))}` : fmtUsd(Number(t.priceUsd))) : "—"}
      </td>

      {/* 24h */}
      <td className={`mono px-3 py-2.5 text-right text-[12px] font-medium ${change == null ? "text-ink-3" : change >= 0 ? "text-up" : "text-down"}`}>
        {change == null ? "—" : fmtPct(change)}
      </td>

      {/* MCap */}
      <td className="mono px-3 py-2.5 text-right text-[12px] text-ink">{fmtUsd(Number(t.marketCapUsd))}</td>

      {/* Liquidity */}
      <td className="mono hidden px-3 py-2.5 text-right text-[12px] text-ink-2 md:table-cell">
        {fmtWeiUsd(t.liquidityWei, rate)}
      </td>

      {/* Vol 24h */}
      <td className="mono px-3 py-2.5 text-right text-[12px] text-ink-2">{fmtWeiUsd(t.volume24hWei, rate)}</td>

      {/* Txns */}
      <td className="mono hidden px-3 py-2.5 text-right text-[12px] text-ink-2 lg:table-cell">{compact(t.txCount24h)}</td>

      {/* Holders */}
      <td className="mono hidden px-3 py-2.5 text-right text-[12px] text-ink-2 lg:table-cell">{compact(t.holderCount)}</td>

      {/* Chart */}
      <td className="hidden px-3 py-1.5 xl:table-cell">
        <div className="flex justify-end">
          <MiniChart token={t.address} width={92} height={30} />
        </div>
      </td>

      {/* Action */}
      <td className="py-2.5 pl-3 pr-4 text-right">
        <Link
          to={`/token/${t.address}`}
          className="inline-flex items-center rounded-md border border-edge-2 bg-panel px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-ink transition-colors hover:border-accent hover:text-accent"
        >
          Trade
        </Link>
      </td>
    </tr>
  );
}

function RowSkeleton() {
  return (
    <tr className="border-b border-edge/60">
      <td className="py-3 pl-4 pr-3">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 shrink-0 animate-pulse rounded-lg bg-panel-2" />
          <div className="space-y-1.5">
            <div className="h-3 w-24 animate-pulse rounded bg-panel-2" />
            <div className="h-2.5 w-14 animate-pulse rounded bg-panel-2" />
          </div>
        </div>
      </td>
      {[...Array(9)].map((_, i) => (
        <td key={i} className="px-3 py-3">
          <div className="ml-auto h-3 w-12 animate-pulse rounded bg-panel-2" />
        </td>
      ))}
    </tr>
  );
}

function Empty({ q }: { q: string }) {
  return (
    <div className="flex flex-col items-center py-20 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-xl bg-panel-2 text-ink-3">
        <Icon name={q ? "search" : "trending"} size={22} />
      </span>
      <p className="mt-3 text-[14px] font-semibold text-ink">
        {q ? `No market for “${q}”` : "No markets yet"}
      </p>
      <p className="mono mt-1 text-[12px] text-ink-3">
        {q ? "Try another name, symbol or address." : "Launch the first token to open a market."}
      </p>
    </div>
  );
}
