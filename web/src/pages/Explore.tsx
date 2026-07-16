import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTokens } from "@launchpad/sdk/react";
import type { TokenSummary } from "@launchpad/sdk";

import { Icon, type IconName } from "../components/Icon";
import { MiniChart } from "../components/MiniChart";
import { Skeleton } from "../components/ui";
import { client } from "../lib/client";
import { env } from "../lib/env";
import { fmtPct, fmtUsd, fmtWeiUsd, timeAgo, usdRateOf } from "../lib/format";
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
    () => [...all].sort((a, b) => Number(b.volume24hWei) - Number(a.volume24hWei)).slice(0, 12),
    [all],
  );
  const fresh = useMemo(() => [...all].sort((a, b) => b.createdAt - a.createdAt).slice(0, 12), [all]);
  const active = useMemo(
    () => [...all].filter((t) => t.txCount24h > 0).sort((a, b) => b.txCount24h - a.txCount24h).slice(0, 8),
    [all],
  );
  const maxVol = useMemo(() => Math.max(1, ...active.map((t) => Number(t.volume24hWei))), [active]);

  const loading = !hidden && (loadingVolume || loadingNew);
  const empty = !loading && all.length === 0;

  return (
    <div className="mx-auto max-w-3xl px-4 pb-16 sm:px-6">
      {/* Search */}
      <label className="relative block">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-3">
          <Icon name="search" size={19} />
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tokens"
          type="search"
          className="h-12 w-full rounded-full border border-edge bg-panel pl-11 pr-4 text-[15px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-ink"
        />
      </label>

      {loading ? (
        <div className="mt-8 space-y-2.5">
          {[...Array(7)].map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-xl" />
          ))}
        </div>
      ) : empty ? (
        <p className="mt-24 text-center text-[15px] text-ink-2">No tokens yet. Launch the first one.</p>
      ) : q ? (
        <div className="mt-6 rise">
          <Eyebrow icon="search" label={`${results.length} result${results.length === 1 ? "" : "s"}`} />
          {results.length === 0 ? (
            <p className="py-10 text-center text-[15px] text-ink-2">Nothing matches “{query}”.</p>
          ) : (
            <div>{results.map((t) => <TrendRow key={t.address} t={t} />)}</div>
          )}
        </div>
      ) : (
        <>
          {/* Just launched — horizontal chip rail */}
          {fresh.length > 0 ? (
            <section className="mt-7 rise">
              <Eyebrow icon="new" label="Just launched" />
              <div className="no-scrollbar -mx-4 flex gap-2.5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
                {fresh.map((t) => (
                  <LaunchChip key={t.address} t={t} />
                ))}
              </div>
            </section>
          ) : null}

          {/* Trending — dense leaderboard */}
          {trending.length > 0 ? (
            <section className="mt-9 rise">
              <Eyebrow icon="trending" label="Trending" />
              <div>
                {trending.map((t, i) => (
                  <TrendRow key={t.address} t={t} rank={i + 1} />
                ))}
              </div>
            </section>
          ) : null}

          {/* Most active — volume bars */}
          {active.length > 0 ? (
            <section className="mt-9 rise">
              <Eyebrow icon="activity" label="Most active" />
              <div className="mt-1 space-y-0.5">
                {active.map((t) => (
                  <ActiveRow key={t.address} t={t} share={Number(t.volume24hWei) / maxVol} />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function Eyebrow({ icon, label }: { icon: IconName; label: string }) {
  return (
    <div className="mb-2 flex items-center gap-2.5">
      <span className="text-ink-2">
        <Icon name={icon} size={15} />
      </span>
      <h2 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-ink-2">{label}</h2>
      <span className="h-px flex-1 bg-edge" />
    </div>
  );
}

function Logo({ t, size = 30 }: { t: TokenSummary; size?: number }) {
  const logo = t.metadata?.logo;
  const ok = logo && /^(https?:|ipfs:|data:)/.test(String(logo));
  const src = ok
    ? String(logo).startsWith("ipfs://")
      ? `https://ipfs.io/ipfs/${String(logo).slice(7)}`
      : String(logo)
    : null;
  return (
    <div
      className="grid shrink-0 place-items-center overflow-hidden rounded-xl bg-panel-2 text-[11px] font-bold text-ink-3"
      style={{ width: size, height: size }}
    >
      {src ? (
        <img src={src} alt="" loading="lazy" className="h-full w-full object-cover"
          onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
      ) : (
        t.symbol.slice(0, 3).toUpperCase()
      )}
    </div>
  );
}

function LaunchChip({ t }: { t: TokenSummary }) {
  return (
    <Link
      to={`/token/${t.address}`}
      className="flex shrink-0 items-center gap-2.5 rounded-2xl border border-edge bg-panel py-2 pl-2 pr-3.5 transition-colors hover:border-edge-2"
    >
      <Logo t={t} size={34} />
      <div className="min-w-0">
        <p className="max-w-[120px] truncate text-[13.5px] font-semibold leading-tight text-ink">{t.name}</p>
        <p className="text-[11px] text-ink-3">{timeAgo(t.createdAt)}</p>
      </div>
    </Link>
  );
}

function TrendRow({ t, rank }: { t: TokenSummary; rank?: number }) {
  const change = t.priceChange24hPct;
  return (
    <Link
      to={`/token/${t.address}`}
      className="-mx-2 flex items-center gap-3 rounded-xl border-b border-edge px-2 py-3 transition-colors last:border-0 hover:bg-panel-2"
    >
      {rank != null ? (
        <span className={`tnum w-4 shrink-0 text-center text-[13px] font-semibold ${rank <= 3 ? "text-ink" : "text-ink-3"}`}>
          {rank}
        </span>
      ) : null}
      <Logo t={t} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold leading-tight text-ink">{t.name}</p>
        <p className="tnum text-[12px] text-ink-3">${t.symbol}</p>
      </div>
      <div className="hidden shrink-0 sm:block">
        <MiniChart token={t.address} width={76} height={28} />
      </div>
      <div className="w-[92px] shrink-0 text-right">
        <p className="tnum text-[15px] font-semibold leading-tight text-ink">{fmtUsd(t.marketCapUsd)}</p>
        <p className={`tnum text-[12px] font-medium ${change == null ? "text-ink-3" : change >= 0 ? "text-up" : "text-down"}`}>
          {change == null ? "—" : fmtPct(change)}
        </p>
      </div>
    </Link>
  );
}

function ActiveRow({ t, share }: { t: TokenSummary; share: number }) {
  const rate = usdRateOf(t);
  return (
    <Link
      to={`/token/${t.address}`}
      className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-panel-2"
    >
      <Logo t={t} size={28} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate text-[14px] font-semibold text-ink">{t.name}</p>
          <p className="tnum shrink-0 text-[13px] font-medium text-ink-2">{fmtWeiUsd(t.volume24hWei, rate)}</p>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel-2">
            <span
              className="block h-full rounded-full bg-accent transition-[width] duration-500"
              style={{ width: `${Math.max(share * 100, 3)}%` }}
            />
          </span>
          <span className="tnum shrink-0 text-[11px] text-ink-3">{t.txCount24h} txns</span>
        </div>
      </div>
    </Link>
  );
}
