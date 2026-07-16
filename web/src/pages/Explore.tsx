import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTokens } from "@launchpad/sdk/react";
import type { TokenSummary } from "@launchpad/sdk";

import { AnimatedNumber } from "../components/AnimatedNumber";
import { Icon } from "../components/Icon";
import { MiniChart } from "../components/MiniChart";
import { client } from "../lib/client";
import { env } from "../lib/env";
import { compact, fmtPct, fmtUsd, fmtWeiUsd, timeAgo, usdRateOf } from "../lib/format";
import { isHidden } from "../lib/hiddenTokens";
import { STOCKS, stockOf } from "../lib/v4/stocks";

type Sort = "trending" | "new" | "top";

const SORTS: { id: Sort; label: string }[] = [
  { id: "trending", label: "Trending" },
  { id: "new", label: "New" },
  { id: "top", label: "Top" },
];

/**
 * The product surface, built around what the protocol actually does: every
 * market pays its holders a real tokenized stock out of trade fees. So the page
 * leads with that mechanic, lets you filter markets by the stock you want to
 * earn, and lists them in a dense, functional table — not marketing cards.
 */
export function Explore() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sort, setSort] = useState<Sort>("trending");
  const [stockFilter, setStockFilter] = useState<string | null>(null);
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

  const rewardOf = (t: TokenSummary) => String((t.metadata as any)?.rewardStock ?? "").toLowerCase();

  // How many live markets pay each stock — drives the "earn" rail.
  const stockCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of all) m.set(rewardOf(t), (m.get(rewardOf(t)) ?? 0) + 1);
    return m;
  }, [all]);

  const feed = useMemo(() => {
    let list = all;
    const q = debounced;
    if (q) {
      list = all.filter(
        (t) => t.name.toLowerCase().includes(q) || t.symbol.toLowerCase().includes(q) || t.address.toLowerCase() === q,
      );
    }
    if (stockFilter) list = list.filter((t) => rewardOf(t) === stockFilter.toLowerCase());
    const s = [...list];
    if (sort === "new") s.sort((a, b) => b.createdAt - a.createdAt);
    else if (sort === "top") s.sort((a, b) => Number(b.marketCapUsd) - Number(a.marketCapUsd));
    else s.sort((a, b) => Number(b.volume24hWei) - Number(a.volume24hWei));
    return s;
  }, [all, debounced, stockFilter, sort]);

  const stats = useMemo(() => {
    const rate = all.find((t) => usdRateOf(t) > 0);
    const r = rate ? usdRateOf(rate) : 0;
    const vol = all.reduce((a, t) => a + (Number(t.volume24hWei) / 1e18) * r, 0);
    const cap = all.reduce((a, t) => a + Number(t.marketCapUsd), 0);
    return { markets: all.length, vol, cap };
  }, [all]);

  const loading = !hidden && (lv || ln) && all.length === 0;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
      <Masthead stats={stats} />

      {/* Earn rail — filter markets by the stock they pay you */}
      <EarnRail counts={stockCounts} active={stockFilter} onPick={setStockFilter} />

      {/* Toolbar */}
      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1 rounded-lg border border-edge bg-panel p-1">
          {SORTS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSort(s.id)}
              className={`rounded-md px-3.5 py-1.5 text-[13.5px] font-medium transition-colors ${
                sort === s.id ? "bg-ink text-white" : "text-ink-2 hover:text-ink"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <label className="relative block sm:w-80">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3">
            <Icon name="search" size={17} />
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tokens…"
            type="search"
            className="h-11 w-full rounded-lg border border-edge bg-panel pl-10 pr-4 text-[14px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-ink/30"
          />
        </label>
      </div>

      {/* Markets */}
      <div className="mt-4 overflow-hidden rounded-xl border border-edge bg-panel">
        <div className="flex items-center gap-4 border-b border-edge px-4 py-2.5 text-[11px] font-medium text-ink-3 sm:px-5">
          <span className="hidden w-6 sm:block">#</span>
          <span className="flex-1">Market</span>
          <span className="hidden w-[120px] lg:block">Holders earn</span>
          <span className="hidden w-[88px] md:block">Last 7d</span>
          <span className="w-[64px] text-right sm:w-[80px]">24h</span>
          <span className="w-[96px] text-right sm:w-[120px]">Market cap</span>
          <span className="hidden w-[92px] sm:block" />
        </div>

        {loading ? (
          [...Array(6)].map((_, i) => <RowSkeleton key={i} />)
        ) : feed.length === 0 ? (
          <Empty q={debounced} filtered={Boolean(stockFilter)} onClear={() => { setStockFilter(null); setQuery(""); }} />
        ) : (
          <div className="divide-y divide-edge">
            {feed.map((t, i) => <MarketRow key={t.address} t={t} rank={i + 1} />)}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Masthead: mechanic + live protocol figures ---------------- */

function Masthead({ stats }: { stats: { markets: number; vol: number; cap: number } }) {
  return (
    <section className="pt-9">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-xl">
          <h1 className="text-[30px] font-bold leading-[1.1] tracking-tight text-ink sm:text-[36px]">
            Launch a coin. Holders earn stocks.
          </h1>
          <p className="mt-2.5 text-[15px] leading-relaxed text-ink-2">
            Every market taxes each trade and buys a real tokenized stock — NVDA, TSLA, AAPL — then
            streams it to holders by weight. Pick the stock you want to earn.
          </p>
          <Link
            to="/launch"
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-[14px] font-semibold text-white transition-opacity hover:opacity-90"
          >
            Launch a token
            <Icon name="forward" size={15} />
          </Link>
        </div>

        {/* Fee split — the contract's 25/25/25/25, shown plainly */}
        <div className="w-full max-w-md lg:w-[420px]">
          <p className="mb-2 text-[12px] font-medium text-ink-2">Where every trade’s tax goes</p>
          <div className="flex h-2 overflow-hidden rounded-full">
            <span className="w-1/4 bg-accent" title="Holders earn stock" />
            <span className="w-1/4 bg-ink" title="Creator" />
            <span className="w-1/4 bg-ink-2" title="Buyback & burn" />
            <span className="w-1/4 bg-ink-3" title="Protocol" />
          </div>
          <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12.5px] sm:grid-cols-4">
            <Split dot="bg-accent" label="Holders" />
            <Split dot="bg-ink" label="Creator" />
            <Split dot="bg-ink-2" label="Buyback" />
            <Split dot="bg-ink-3" label="Protocol" />
          </div>
        </div>
      </div>

      {/* Live figures */}
      <div className="mt-8 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-edge bg-edge">
        <Stat label="Markets" value={<AnimatedNumber value={stats.markets} format={(n) => compact(Math.round(n))} />} />
        <Stat label="24h volume" value={<AnimatedNumber value={stats.vol} format={(n) => fmtUsd(n)} />} />
        <Stat label="Total market cap" value={<AnimatedNumber value={stats.cap} format={(n) => fmtUsd(n)} />} />
      </div>
    </section>
  );
}

function Split({ dot, label }: { dot: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-ink-2">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      25% {label}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-panel px-4 py-3.5">
      <p className="text-[12px] text-ink-2">{label}</p>
      <p className="mono mt-1 text-[22px] font-bold tracking-tight text-ink">{value}</p>
    </div>
  );
}

/* ---------------- Earn rail: filter by reward stock ---------------- */

function EarnRail({
  counts,
  active,
  onPick,
}: {
  counts: Map<string, number>;
  active: string | null;
  onPick: (s: string | null) => void;
}) {
  // Show stocks that actually have markets first, then the rest of the catalog.
  const ordered = [...STOCKS].sort(
    (a, b) => (counts.get(b.address.toLowerCase()) ?? 0) - (counts.get(a.address.toLowerCase()) ?? 0),
  );
  return (
    <div className="mt-7">
      <div className="mb-2.5 flex items-center justify-between">
        <p className="text-[13px] font-semibold text-ink">Earn a stock</p>
        {active ? (
          <button onClick={() => onPick(null)} className="text-[12.5px] font-medium text-ink-2 hover:text-ink">
            Clear
          </button>
        ) : null}
      </div>
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        {ordered.map((s) => {
          const n = counts.get(s.address.toLowerCase()) ?? 0;
          const on = active?.toLowerCase() === s.address.toLowerCase();
          return (
            <button
              key={s.address}
              onClick={() => onPick(on ? null : s.address)}
              className={`flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-2 text-[13px] transition-colors ${
                on ? "border-ink bg-ink text-white" : "border-edge bg-panel text-ink hover:border-ink/30"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${on ? "bg-accent" : "bg-accent"}`} />
              <span className="font-semibold">{s.symbol}</span>
              <span className={on ? "text-white/60" : "text-ink-3"}>{n}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- Market row ---------------- */

function MarketRow({ t, rank }: { t: TokenSummary; rank: number }) {
  const rate = usdRateOf(t);
  const change = t.priceChange24hPct;
  const stock = stockOf((t.metadata as any)?.rewardStock);
  const logo = t.metadata?.logo;
  const ok = logo && /^(https?:|ipfs:|data:)/.test(String(logo));
  const src = ok
    ? String(logo).startsWith("ipfs://") ? `https://ipfs.io/ipfs/${String(logo).slice(7)}` : String(logo)
    : null;

  return (
    <div className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-panel-2/50 sm:px-5">
      <span className="mono hidden w-6 text-[13px] text-ink-3 sm:block">{rank}</span>

      <Link to={`/token/${t.address}`} className="flex min-w-0 flex-1 items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full border border-edge bg-panel-2 text-[11px] font-bold text-ink-3">
          {src ? (
            <img src={src} alt="" loading="lazy" className="h-full w-full object-cover"
              onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
          ) : (
            t.symbol.slice(0, 2).toUpperCase()
          )}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[14.5px] font-semibold leading-tight text-ink group-hover:text-ink">{t.name}</span>
          <span className="block truncate text-[12px] text-ink-3">{t.symbol} · {timeAgo(t.createdAt)}</span>
        </span>
      </Link>

      <div className="hidden w-[120px] lg:block">
        {stock ? (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-panel-2 px-2 py-1 text-[12px] font-medium text-ink-2">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            {stock.symbol}
          </span>
        ) : <span className="text-[12px] text-ink-3">—</span>}
      </div>

      <Link to={`/token/${t.address}`} className="hidden w-[88px] md:block">
        <MiniChart token={t.address} width={88} height={30} />
      </Link>

      <div className={`w-[64px] text-right sm:w-[80px] ${change == null ? "text-ink-3" : change >= 0 ? "text-up" : "text-down"}`}>
        <span className="mono text-[13.5px] font-medium">{change == null ? "—" : fmtPct(change)}</span>
      </div>

      <Link to={`/token/${t.address}`} className="w-[96px] text-right sm:w-[120px]">
        <span className="mono block text-[14px] font-semibold text-ink">{fmtUsd(t.marketCapUsd)}</span>
        <span className="mono block text-[11px] text-ink-3">{fmtWeiUsd(t.volume24hWei, rate)} vol</span>
      </Link>

      <div className="hidden w-[92px] justify-end sm:flex">
        <Link
          to={`/token/${t.address}`}
          className="rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-accent-2"
        >
          Trade
        </Link>
      </div>
    </div>
  );
}

function RowSkeleton() {
  return (
    <div className="flex items-center gap-4 px-4 py-3 sm:px-5">
      <div className="hidden h-3 w-6 animate-pulse rounded bg-panel-2 sm:block" />
      <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-panel-2" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 w-32 animate-pulse rounded bg-panel-2" />
        <div className="h-2.5 w-20 animate-pulse rounded bg-panel-2" />
      </div>
      <div className="h-4 w-14 animate-pulse rounded bg-panel-2" />
      <div className="h-5 w-24 animate-pulse rounded bg-panel-2" />
    </div>
  );
}

function Empty({ q, filtered, onClear }: { q: string; filtered: boolean; onClear: () => void }) {
  return (
    <div className="flex flex-col items-center px-6 py-20 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-panel-2 text-ink-3">
        <Icon name={q ? "search" : "trending"} size={22} />
      </span>
      <p className="mt-4 text-[16px] font-semibold text-ink">
        {q ? `No market for “${q}”` : filtered ? "No markets pay that stock yet" : "No markets yet"}
      </p>
      {q || filtered ? (
        <button onClick={onClear} className="mt-3 text-[13.5px] font-medium text-ink-2 underline underline-offset-2 hover:text-ink">
          Clear filters
        </button>
      ) : (
        <Link to="/launch" className="mt-4 rounded-lg bg-ink px-4 py-2.5 text-[13.5px] font-semibold text-white hover:opacity-90">
          Launch the first token
        </Link>
      )}
    </div>
  );
}
