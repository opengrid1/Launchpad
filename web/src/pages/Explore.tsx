import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTokens } from "@launchpad/sdk/react";
import type { TokenSummary } from "@launchpad/sdk";

import { Icon } from "../components/Icon";
import { MiniChart } from "../components/MiniChart";
import { client } from "../lib/client";
import { env } from "../lib/env";
import { compact, fmtPct, fmtUsd, fmtWeiUsd, usdRateOf } from "../lib/format";
import { isHidden } from "../lib/hiddenTokens";
import { stockOf } from "../lib/v4/stocks";

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

  // Live protocol figures for the masthead line.
  const stats = useMemo(() => {
    const rate = all.find((t) => usdRateOf(t) > 0);
    const r = rate ? usdRateOf(rate) : 0;
    const volUsd = all.reduce((a, t) => a + (Number(t.volume24hWei) / 1e18) * r, 0);
    const capUsd = all.reduce((a, t) => a + Number(t.marketCapUsd), 0);
    return { markets: all.length, volUsd, capUsd };
  }, [all]);

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-10 sm:px-6">
      {/* Masthead */}
      <header className="flex flex-col gap-8 border-b border-edge pb-9 md:flex-row md:items-end md:justify-between">
        <div className="max-w-2xl">
          <p className="mono text-[11px] font-medium uppercase tracking-[0.18em] text-ink-3">
            Robinhood Chain · Uniswap&nbsp;V4
          </p>
          <h1 className="font-display mt-3 text-[46px] leading-[0.98] tracking-[-0.01em] text-ink sm:text-[62px]">
            Launch real markets,
            <br />
            <span className="italic text-accent-2">holders earn stocks.</span>
          </h1>
          <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-ink-2">
            Every token opens a live Uniswap market. A slice of every trade buys tokenized
            equities — NVDA, TSLA, AAPL — and streams them to holders by weight. No staking, no
            claims to chase.
          </p>
        </div>
        <Link
          to="/launch"
          className="group inline-flex shrink-0 items-center gap-2 self-start rounded-full bg-accent px-6 py-3.5 text-[15px] font-bold text-white transition-colors hover:bg-accent-2 md:self-auto"
        >
          Launch a token
          <span className="transition-transform group-hover:translate-x-0.5">→</span>
        </Link>
      </header>

      {/* Live figures */}
      <dl className="mono flex flex-wrap items-center gap-x-8 gap-y-2 py-5 text-[13px]">
        <Figure label="Markets" value={compact(stats.markets)} />
        <span className="hidden h-3 w-px bg-edge-2 sm:block" />
        <Figure label="24h volume" value={fmtUsd(stats.volUsd)} />
        <span className="hidden h-3 w-px bg-edge-2 sm:block" />
        <Figure label="Total market cap" value={fmtUsd(stats.capUsd)} />
      </dl>

      {/* Toolbar */}
      <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1 rounded-full border border-edge bg-panel p-1">
          {lenses.map((l) => (
            <button
              key={l.id}
              onClick={() => { setLens(l.id); setQuery(""); }}
              className={`rounded-full px-4 py-1.5 text-[13.5px] font-semibold transition-colors ${
                lens === l.id && !q ? "bg-ink text-white" : "text-ink-2 hover:text-ink"
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
        <label className="relative block sm:w-72">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3">
            <Icon name="search" size={17} />
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, symbol, address"
            type="search"
            className="h-10 w-full rounded-full border border-edge bg-panel pl-10 pr-4 text-[14px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-accent/50"
          />
        </label>
      </div>

      {/* Markets table */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-edge bg-panel">
        {/* Column header */}
        <div className="mono flex items-center gap-4 border-b border-edge px-4 py-2.5 text-[10.5px] font-medium uppercase tracking-wider text-ink-3 sm:px-5">
          <span className="hidden w-6 sm:block">#</span>
          <span className="flex-1">Market</span>
          <span className="hidden w-[124px] lg:block">Rewards</span>
          <span className="hidden w-[92px] md:block">7d</span>
          <span className="w-[70px] text-right sm:w-[84px]">24h</span>
          <span className="w-[92px] text-right sm:w-[124px]">Market cap</span>
        </div>

        {loading ? (
          [...Array(7)].map((_, i) => <RowSkeleton key={i} />)
        ) : feed.length === 0 ? (
          <Empty q={query} />
        ) : (
          <div className="divide-y divide-edge">
            {feed.map((t, i) => (
              <MarketRow key={t.address} t={t} rank={i + 1} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-[11px] uppercase tracking-wider text-ink-3">{label}</dt>
      <dd className="tnum font-semibold text-ink">{value}</dd>
    </div>
  );
}

function MarketRow({ t, rank }: { t: TokenSummary; rank: number }) {
  const rate = usdRateOf(t);
  const change = t.priceChange24hPct;
  const stock = stockOf((t.metadata as any)?.rewardStock);
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
      className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-panel-2 sm:px-5"
    >
      <span className="mono hidden w-6 text-[13px] tabular-nums text-ink-3 sm:block">
        {String(rank).padStart(2, "0")}
      </span>

      {/* Market identity */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-panel-2 text-[12px] font-bold text-ink-3 ring-1 ring-edge">
          {src ? (
            <img src={src} alt="" loading="lazy" className="h-full w-full object-cover"
              onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
          ) : (
            t.symbol.slice(0, 3).toUpperCase()
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold leading-tight tracking-tight text-ink group-hover:text-accent-2">
            {t.name}
          </p>
          <p className="mono truncate text-[12px] text-ink-3">{t.symbol}</p>
        </div>
      </div>

      {/* Reward stock */}
      <div className="hidden w-[124px] lg:block">
        {stock ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-panel px-2.5 py-1 text-[12px] font-semibold text-ink-2">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            {stock.symbol}
          </span>
        ) : (
          <span className="text-[12px] text-ink-3">—</span>
        )}
      </div>

      {/* Sparkline */}
      <div className="hidden w-[92px] md:block">
        <MiniChart token={t.address} width={92} height={30} />
      </div>

      {/* 24h change */}
      <div className={`w-[70px] text-right sm:w-[84px] ${change == null ? "text-ink-3" : change >= 0 ? "text-up" : "text-down"}`}>
        <span className="mono text-[13.5px] font-semibold tabular-nums">
          {change == null ? "–" : fmtPct(change)}
        </span>
      </div>

      {/* Market cap */}
      <div className="w-[92px] text-right sm:w-[124px]">
        <p className="mono text-[14.5px] font-semibold tabular-nums text-ink">{fmtUsd(t.marketCapUsd)}</p>
        <p className="mono text-[11px] tabular-nums text-ink-3">{fmtWeiUsd(t.volume24hWei, rate)} vol</p>
      </div>
    </Link>
  );
}

function RowSkeleton() {
  return (
    <div className="flex items-center gap-4 px-4 py-3 sm:px-5">
      <div className="hidden h-3 w-6 animate-pulse rounded bg-panel-2 sm:block" />
      <div className="h-10 w-10 shrink-0 animate-pulse rounded-xl bg-panel-2" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 w-32 animate-pulse rounded bg-panel-2" />
        <div className="h-2.5 w-16 animate-pulse rounded bg-panel-2" />
      </div>
      <div className="h-4 w-16 animate-pulse rounded bg-panel-2" />
      <div className="h-5 w-24 animate-pulse rounded bg-panel-2" />
    </div>
  );
}

function Empty({ q }: { q: string }) {
  return (
    <div className="flex flex-col items-center px-6 py-20 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-panel-2 text-ink-3">
        <Icon name={q ? "search" : "trending"} size={24} />
      </span>
      <p className="mt-4 text-[16px] font-semibold text-ink">
        {q ? `No market for “${q}”` : "No markets yet"}
      </p>
      <p className="mt-1 text-[14px] text-ink-3">
        {q ? "Try another name, symbol or address." : "Launch the first token to open a market."}
      </p>
      {!q ? (
        <Link to="/launch" className="mt-5 rounded-full bg-accent px-5 py-2.5 text-[14px] font-bold text-white transition-colors hover:bg-accent-2">
          Launch a token
        </Link>
      ) : null}
    </div>
  );
}
