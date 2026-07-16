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
    return list.slice(0, 50);
  }, [all, q, lens]);

  const loading = !hidden && (lv || ln);

  return (
    <div className="mx-auto max-w-2xl px-5 pb-24 pt-5">
      {/* Search */}
      <label className="relative block">
        <span className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-ink-3">
          <Icon name="search" size={20} />
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search markets"
          type="search"
          className="h-14 w-full rounded-[20px] border border-edge bg-panel pl-[52px] pr-5 text-[16px] text-ink shadow-[var(--shadow-card)] outline-none transition-colors placeholder:text-ink-3 focus:border-ink"
        />
      </label>

      {/* Lens — understated text switch */}
      {!q ? (
        <div className="mt-6 flex items-center gap-6">
          {lenses.map((l) => (
            <button
              key={l.id}
              onClick={() => setLens(l.id)}
              className={`relative text-[15px] transition-colors ${
                lens === l.id ? "font-semibold text-ink" : "font-medium text-ink-3 hover:text-ink-2"
              }`}
            >
              {l.label}
              {lens === l.id ? (
                <span className="absolute -bottom-2 left-0 h-[3px] w-full rounded-full bg-accent" />
              ) : null}
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-6 text-[13px] font-medium text-ink-3">
          {feed.length} market{feed.length === 1 ? "" : "s"}
        </p>
      )}

      {/* Feed */}
      <div className="mt-3">
        {loading ? (
          [...Array(6)].map((_, i) => <LineSkeleton key={i} />)
        ) : feed.length === 0 ? (
          <Empty q={query} />
        ) : (
          feed.map((t) => <MarketLine key={t.address} t={t} />)
        )}
      </div>
    </div>
  );
}

function MarketLine({ t }: { t: TokenSummary }) {
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
      className="group flex items-center gap-4 border-b border-edge py-4 transition-opacity last:border-0 hover:opacity-100"
    >
      <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl bg-panel-2 text-[12px] font-bold text-ink-3">
        {src ? (
          <img src={src} alt="" loading="lazy" className="h-full w-full object-cover"
            onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
        ) : (
          t.symbol.slice(0, 3).toUpperCase()
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[17px] font-semibold leading-tight tracking-tight text-ink">{t.name}</p>
        <p className="mt-0.5 flex items-center gap-2 text-[13px] text-ink-3">
          <span className="tnum">${t.symbol}</span>
          <span aria-hidden>·</span>
          <span className="tnum">{fmtWeiUsd(t.volume24hWei, rate)} vol</span>
        </p>
      </div>

      <div className="hidden shrink-0 opacity-90 sm:block">
        <MiniChart token={t.address} width={84} height={34} />
      </div>

      <div className="w-[96px] shrink-0 text-right">
        <p className="tnum text-[16px] font-semibold leading-tight text-ink">{fmtUsd(t.marketCapUsd)}</p>
        <p className={`tnum mt-0.5 text-[13px] font-medium ${change == null ? "text-ink-3" : change >= 0 ? "text-up" : "text-down"}`}>
          {change == null ? "—" : fmtPct(change)}
        </p>
      </div>
    </Link>
  );
}

function LineSkeleton() {
  return (
    <div className="flex items-center gap-4 border-b border-edge py-4 last:border-0">
      <div className="h-12 w-12 shrink-0 animate-pulse rounded-2xl bg-panel-2" />
      <div className="flex-1 space-y-2">
        <div className="h-4 w-32 animate-pulse rounded bg-panel-2" />
        <div className="h-3 w-24 animate-pulse rounded bg-panel-2" />
      </div>
      <div className="h-4 w-16 animate-pulse rounded bg-panel-2" />
    </div>
  );
}

function Empty({ q }: { q: string }) {
  return (
    <div className="flex flex-col items-center py-24 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-panel-2 text-ink-3">
        <Icon name={q ? "search" : "trending"} size={26} />
      </span>
      <p className="mt-4 text-[15px] font-medium text-ink">
        {q ? `No market for “${q}”` : "No markets yet"}
      </p>
      <p className="mt-1 text-[13px] text-ink-3">
        {q ? "Try another name, symbol or address." : "Launch the first token to open a market."}
      </p>
    </div>
  );
}
