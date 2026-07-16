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
import { stockOf } from "../lib/v4/stocks";

/**
 * The front page, composed like a financial publication rather than a wall of
 * identical cards: an edition line, a lead "Featured Market" story, then a
 * numbered "Most traded" column, a set of "New launches" briefs and a compact
 * "Recently active" ledger — each with its own rhythm. Sections appear only
 * when there's enough to fill them, so it reads intentional at any size.
 */
export function Explore() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
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
  const results = useMemo(() => {
    if (!q) return [];
    return all.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.symbol.toLowerCase().includes(q) ||
        t.address.toLowerCase() === q,
    );
  }, [all, q]);

  const byVol = useMemo(() => [...all].sort((a, b) => Number(b.volume24hWei) - Number(a.volume24hWei)), [all]);
  const featured = byVol[0];
  const rest = byVol.slice(1);
  const trending = rest.slice(0, 5);
  const fresh = useMemo(() => [...rest].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6), [rest]);
  const active = useMemo(
    () => [...rest].sort((a, b) => b.txCount24h - a.txCount24h).filter((t) => t.txCount24h > 0).slice(0, 8),
    [rest],
  );

  const loading = !hidden && (lv || ln) && all.length === 0;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-28 sm:px-8">
      <EditionLine count={all.length} />

      <SearchBar value={query} onChange={setQuery} />

      {loading ? (
        <LeadSkeleton />
      ) : q ? (
        <SearchResults query={query} items={results} />
      ) : !featured ? (
        <EmptyFront />
      ) : (
        <div className="space-y-16">
          <FeaturedStory t={featured} />

          {trending.length > 0 ? (
            <Section
              kicker="Most traded"
              title="Trending markets"
              deck="Where the volume is going over the last 24 hours."
            >
              <TrendingList items={trending} />
            </Section>
          ) : null}

          {fresh.length > 0 ? (
            <Section
              kicker="Off the press"
              title="New launches"
              deck="The latest markets to open on Quiverpad."
            >
              <BriefsGrid items={fresh} />
            </Section>
          ) : null}

          {active.length > 0 ? (
            <Section kicker="The ledger" title="Recently active" deck="Markets trading right now.">
              <ActiveLedger items={active} />
            </Section>
          ) : null}

          {rest.length === 0 ? <NextToLaunch /> : null}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Masthead + search                                                   */
/* ------------------------------------------------------------------ */

function EditionLine({ count }: { count: number }) {
  const date = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return (
    <div className="flex items-center justify-between border-b border-ink/80 pb-3 pt-8">
      <span className="kicker text-[13px] text-ink">Quiverpad Markets</span>
      <span className="hidden text-[13px] text-ink-2 sm:block">{date}</span>
      <span className="text-[13px] text-ink-2">
        {compact(count)} market{count === 1 ? "" : "s"}
      </span>
    </div>
  );
}

function SearchBar({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="relative mt-8 block">
      <span className="pointer-events-none absolute left-6 top-1/2 -translate-y-1/2 text-ink-3">
        <Icon name="search" size={20} />
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search tokens…"
        type="search"
        className="h-16 w-full rounded-full border border-edge bg-panel pl-[60px] pr-6 text-[17px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-ink/30"
      />
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* Lead story — Featured Market                                        */
/* ------------------------------------------------------------------ */

function FeaturedStory({ t }: { t: TokenSummary }) {
  const rate = usdRateOf(t);
  const change = t.priceChange24hPct;
  const stock = stockOf((t.metadata as any)?.rewardStock);
  const desc =
    (t.metadata?.description as string) ||
    (stock ? `Every trade routes tokenized ${stock.name} to holders, by weight held.` : "");

  return (
    <section className="fade-in pt-10">
      <p className="kicker text-[13px] text-accent-2">Featured Market</p>
      <div className="mt-4 grid grid-cols-1 gap-x-12 gap-y-8 lg:grid-cols-[1.55fr_1fr]">
        {/* Story */}
        <div>
          <div className="flex items-center gap-4">
            <TokenMark t={t} size={56} />
            <div>
              <h2 className="font-display text-[40px] leading-[1.02] text-ink sm:text-[52px]">{t.name}</h2>
              <p className="mt-1 text-[15px] text-ink-2">
                {t.symbol}
                {stock ? (
                  <>
                    {"  ·  "}
                    <span className="text-ink">holders earn {stock.symbol}</span>
                  </>
                ) : null}
              </p>
            </div>
          </div>

          {desc ? (
            <p className="dropcap mt-6 max-w-xl font-display text-[19px] leading-[1.6] text-ink-2">{desc}</p>
          ) : null}

          <div className="mt-7 overflow-hidden rounded-2xl border border-edge bg-panel">
            <MiniChart token={t.address} width={720} height={200} />
          </div>

          <div className="mt-6 flex items-center gap-3">
            <Link
              to={`/token/${t.address}`}
              className="rounded-full bg-accent px-7 py-3 text-[14px] font-semibold text-ink transition-[filter] hover:brightness-[0.97]"
            >
              Trade {t.symbol}
            </Link>
            <Link
              to={`/token/${t.address}`}
              className="text-[14px] font-medium text-ink-2 underline-offset-4 transition-colors hover:text-ink hover:underline"
            >
              Read the market →
            </Link>
          </div>
        </div>

        {/* Fact box */}
        <aside className="lg:pt-2">
          <div className="rounded-2xl border border-edge bg-panel">
            <FactRow
              label="Market capitalisation"
              node={<AnimatedNumber value={Number(t.marketCapUsd)} format={(n) => fmtUsd(n)} className="tnum" />}
              lead
            />
            <FactRow label="24-hour change" node={
              <span className={change == null ? "text-ink" : change >= 0 ? "text-up" : "text-down"}>
                {change == null ? "—" : fmtPct(change)}
              </span>
            } />
            <FactRow label="24-hour volume" node={<span className="tnum">{fmtWeiUsd(t.volume24hWei, rate)}</span>} />
            <FactRow label="Liquidity" node={<span className="tnum">{fmtWeiUsd(t.liquidityWei, rate)}</span>} />
            <FactRow label="Holders" node={<span className="tnum">{compact(t.holderCount)}</span>} />
            <FactRow label="Opened" node={timeAgo(t.createdAt)} last />
          </div>
        </aside>
      </div>
    </section>
  );
}

function FactRow({ label, node, lead, last }: { label: string; node: React.ReactNode; lead?: boolean; last?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 px-5 py-3.5 ${last ? "" : "border-b border-edge"}`}>
      <span className="text-[13.5px] text-ink-2">{label}</span>
      <span className={`font-display text-ink ${lead ? "text-[28px]" : "text-[17px]"}`}>{node}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Section shell                                                       */
/* ------------------------------------------------------------------ */

function Section({
  kicker,
  title,
  deck,
  children,
}: {
  kicker: string;
  title: string;
  deck: string;
  children: React.ReactNode;
}) {
  return (
    <section className="fade-in">
      <div className="rule mb-6 pt-1" />
      <div className="mb-6 flex items-end justify-between gap-6">
        <div>
          <p className="kicker text-[12.5px] text-accent-2">{kicker}</p>
          <h2 className="font-display mt-1 text-[30px] leading-tight text-ink sm:text-[34px]">{title}</h2>
        </div>
        <p className="standfirst hidden max-w-xs text-right text-[15px] leading-snug sm:block">{deck}</p>
      </div>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Trending — a numbered editorial column                              */
/* ------------------------------------------------------------------ */

function TrendingList({ items }: { items: TokenSummary[] }) {
  return (
    <ol className="border-t border-edge">
      {items.map((t, i) => {
        const rate = usdRateOf(t);
        const change = t.priceChange24hPct;
        const stock = stockOf((t.metadata as any)?.rewardStock);
        return (
          <li key={t.address} className="border-b border-edge">
            <Link to={`/token/${t.address}`} className="group flex items-center gap-5 py-4 transition-colors hover:bg-panel/60">
              <span className="font-display w-8 shrink-0 text-[26px] leading-none text-ink-3">{i + 1}</span>
              <TokenMark t={t} size={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-[20px] leading-tight text-ink group-hover:text-accent-2">{t.name}</p>
                <p className="truncate text-[13px] text-ink-2">
                  {t.symbol}{stock ? ` · earns ${stock.symbol}` : ""}
                </p>
              </div>
              <div className="hidden w-24 md:block">
                <MiniChart token={t.address} width={96} height={30} />
              </div>
              <div className="w-28 text-right">
                <p className="tnum font-display text-[19px] text-ink">{fmtUsd(t.marketCapUsd)}</p>
                <p className="tnum text-[12.5px] text-ink-2">{fmtWeiUsd(t.volume24hWei, rate)} vol</p>
              </div>
              <div className={`w-16 text-right tnum text-[14px] font-medium ${change == null ? "text-ink-3" : change >= 0 ? "text-up" : "text-down"}`}>
                {change == null ? "—" : fmtPct(change)}
              </div>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ */
/* New launches — briefs                                               */
/* ------------------------------------------------------------------ */

function BriefsGrid({ items }: { items: TokenSummary[] }) {
  return (
    <div className="grid grid-cols-1 gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((t) => {
        const stock = stockOf((t.metadata as any)?.rewardStock);
        return (
          <Link key={t.address} to={`/token/${t.address}`} className="group border-t border-ink/80 pt-4">
            <div className="flex items-center gap-3">
              <TokenMark t={t} size={36} />
              <div className="min-w-0">
                <p className="truncate font-display text-[21px] leading-tight text-ink group-hover:text-accent-2">{t.name}</p>
                <p className="text-[12.5px] text-ink-2">{t.symbol}</p>
              </div>
            </div>
            <p className="mt-3 text-[13.5px] leading-relaxed text-ink-2">
              {(t.metadata?.description as string)?.slice(0, 96) ||
                (stock ? `A new market rewarding holders with ${stock.name}.` : "A new market on Quiverpad.")}
            </p>
            <div className="mt-3 flex items-center justify-between text-[13px]">
              <span className="tnum font-medium text-ink">{fmtUsd(t.marketCapUsd)}</span>
              <span className="text-ink-3">{timeAgo(t.createdAt)}</span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Recently active — compact ledger                                    */
/* ------------------------------------------------------------------ */

function ActiveLedger({ items }: { items: TokenSummary[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-edge bg-panel">
      {items.map((t, i) => {
        const rate = usdRateOf(t);
        const change = t.priceChange24hPct;
        return (
          <Link
            key={t.address}
            to={`/token/${t.address}`}
            className={`group flex items-center gap-4 px-5 py-3 transition-colors hover:bg-panel-2/60 ${i ? "border-t border-edge" : ""}`}
          >
            <TokenMark t={t} size={30} />
            <span className="min-w-0 flex-1 truncate text-[15px] text-ink group-hover:text-accent-2">
              {t.name} <span className="text-ink-3">{t.symbol}</span>
            </span>
            <span className="hidden w-32 text-right tnum text-[13.5px] text-ink-2 sm:block">
              {fmtWeiUsd(t.volume24hWei, rate)} vol
            </span>
            <span className="w-24 text-right tnum text-[14px] text-ink">{fmtUsd(t.marketCapUsd)}</span>
            <span className={`w-16 text-right tnum text-[13.5px] ${change == null ? "text-ink-3" : change >= 0 ? "text-up" : "text-down"}`}>
              {change == null ? "—" : fmtPct(change)}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Search results                                                      */
/* ------------------------------------------------------------------ */

function SearchResults({ query, items }: { query: string; items: TokenSummary[] }) {
  if (items.length === 0) {
    return (
      <div className="py-24 text-center">
        <p className="font-display text-[26px] text-ink">No market for “{query}”</p>
        <p className="mt-2 text-[15px] text-ink-2">Try another name, symbol or address.</p>
      </div>
    );
  }
  return (
    <div className="mt-10">
      <p className="kicker mb-4 text-[12.5px] text-ink-2">
        {items.length} result{items.length === 1 ? "" : "s"}
      </p>
      <TrendingList items={items} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Empty / next-to-launch                                              */
/* ------------------------------------------------------------------ */

function NextToLaunch() {
  return (
    <section className="fade-in rounded-2xl border border-edge bg-panel px-8 py-12 text-center">
      <p className="kicker text-[12.5px] text-accent-2">Op-ed</p>
      <h2 className="font-display mx-auto mt-2 max-w-lg text-[30px] leading-tight text-ink">
        The next market is yours to open.
      </h2>
      <p className="mx-auto mt-3 max-w-md text-[15px] text-ink-2">
        Launch a token in one transaction. It opens a live Uniswap market and rewards every holder
        with the tokenized stock you choose.
      </p>
      <Link
        to="/launch"
        className="mt-6 inline-block rounded-full bg-ink px-7 py-3 text-[14px] font-semibold text-white transition-opacity hover:opacity-90"
      >
        Launch a token
      </Link>
    </section>
  );
}

function EmptyFront() {
  return (
    <div className="py-24 text-center">
      <h2 className="font-display text-[34px] leading-tight text-ink">No markets yet</h2>
      <p className="mx-auto mt-3 max-w-md text-[15px] text-ink-2">
        Be the first to open one — a single transaction launches a live market that rewards holders
        with real tokenized stocks.
      </p>
      <Link
        to="/launch"
        className="mt-7 inline-block rounded-full bg-ink px-7 py-3 text-[14px] font-semibold text-white transition-opacity hover:opacity-90"
      >
        Launch the first token
      </Link>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shared token mark                                                   */
/* ------------------------------------------------------------------ */

function TokenMark({ t, size }: { t: TokenSummary; size: number }) {
  const logo = t.metadata?.logo;
  const ok = logo && /^(https?:|ipfs:|data:)/.test(String(logo));
  const src = ok
    ? String(logo).startsWith("ipfs://")
      ? `https://ipfs.io/ipfs/${String(logo).slice(7)}`
      : String(logo)
    : null;
  return (
    <div
      className="grid shrink-0 place-items-center overflow-hidden rounded-full border border-edge bg-panel-2 font-display text-ink-3"
      style={{ height: size, width: size, fontSize: size * 0.34 }}
    >
      {src ? (
        <img src={src} alt="" loading="lazy" className="h-full w-full object-cover"
          onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
      ) : (
        t.symbol.slice(0, 2).toUpperCase()
      )}
    </div>
  );
}

function LeadSkeleton() {
  return (
    <div className="mt-10 grid grid-cols-1 gap-12 pt-10 lg:grid-cols-[1.55fr_1fr]">
      <div>
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 animate-pulse rounded-full bg-panel-2" />
          <div className="space-y-2">
            <div className="h-8 w-52 animate-pulse rounded bg-panel-2" />
            <div className="h-4 w-32 animate-pulse rounded bg-panel-2" />
          </div>
        </div>
        <div className="mt-7 h-[200px] animate-pulse rounded-2xl bg-panel-2" />
      </div>
      <div className="h-72 animate-pulse rounded-2xl bg-panel-2" />
    </div>
  );
}
