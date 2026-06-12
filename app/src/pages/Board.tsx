import { useEffect, useMemo, useState } from 'react'
import { useLaunches, usePlatformStats } from '../hooks/useLaunches'
import { TokenRow, TokenRowHeader, TokenRowSkeleton, PerfBadge } from '../components/TokenRow'
import { TokenImage } from '../components/TokenImage'
import { parseTokenURI } from '../lib/metadata'
import { formatUsd6, formatUnits18 } from '../lib/format'
import type { LaunchRow } from '../lib/launchpad'

type SortKey = 'new' | 'mcap' | 'fees'

export function Board() {
  const { rows, error } = useLaunches()
  const stats = usePlatformStats()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('new')

  const filtered = useMemo(() => {
    if (!rows) return null
    const q = query.trim().toLowerCase()
    const matched = q
      ? rows.filter(
          (r) => r.name.toLowerCase().includes(q) || r.symbol.toLowerCase().includes(q) || r.token.toLowerCase() === q,
        )
      : rows
    const sorted = [...matched]
    if (sort === 'mcap') sorted.sort((a, b) => (b.marketCapUsd6 > a.marketCapUsd6 ? 1 : -1))
    if (sort === 'fees') sorted.sort((a, b) => (b.lifetimeFeesHype > a.lifetimeFeesHype ? 1 : -1))
    return sorted
  }, [rows, query, sort])

  const hypeUsd6 = stats?.hypeUsd6 ?? null

  const aggregates = useMemo(() => {
    if (!rows || !hypeUsd6) return null
    const totalFeesHype = rows.reduce((acc, r) => acc + r.lifetimeFeesHype, 0n)
    const creatorEarningsUsd = (((totalFeesHype * 7000n) / 10000n) * hypeUsd6) / 10n ** 18n
    const combinedMcap = rows.reduce((acc, r) => acc + r.marketCapUsd6, 0n)
    const topEarners = [...rows].sort((a, b) => (b.lifetimeFeesHype > a.lifetimeFeesHype ? 1 : -1)).slice(0, 4)
    const topMcap = [...rows].sort((a, b) => (b.marketCapUsd6 > a.marketCapUsd6 ? 1 : -1)).slice(0, 3)
    return { creatorEarningsUsd, combinedMcap, topEarners, topMcap, count: rows.length }
  }, [rows, hypeUsd6])

  return (
    <main>
      {/* stats strip */}
      <section className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-[1fr_1.3fr_1.1fr]">
        <div className="flex flex-col gap-3">
          <GradientStat
            tone="purple"
            label="Total creator earnings"
            value={aggregates ? formatUsd6(aggregates.creatorEarningsUsd) : '·'}
            icon="$"
          />
          <GradientStat
            tone="blue"
            label="Combined market cap"
            value={aggregates ? formatUsd6(aggregates.combinedMcap) : '·'}
            icon="◎"
          />
        </div>

        <TopEarningCoins rows={aggregates?.topEarners ?? null} hypeUsd6={hypeUsd6} />
        <TopMcap rows={aggregates?.topMcap ?? null} startMcUsd6={stats?.startMcUsd6 ?? null} />
      </section>

      {/* filter pills + search */}
      <section className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:overflow-visible sm:px-0 sm:pb-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {(
            [
              ['✦ New', 'new'],
              ['◎ Top mcap', 'mcap'],
              ['$ Top earners', 'fees'],
            ] as const
          ).map(([label, key]) => (
            <button
              key={key}
              onClick={() => setSort(key)}
              className={`shrink-0 cursor-pointer whitespace-nowrap rounded-full px-4 py-2 text-xs font-bold transition ${
                sort === key ? 'bg-brand text-white' : 'bg-card text-sub ring-1 ring-line hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:max-w-xs">
          <svg className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2" width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="6" cy="6" r="4.5" stroke="var(--color-faint)" strokeWidth="1.5" />
            <path d="M9.5 9.5 L13 13" stroke="var(--color-faint)" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            id="board-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search coins, CA, creators"
            className="w-full rounded-full bg-card py-2.5 pl-9 pr-4 text-sm text-ink ring-1 ring-line outline-none transition placeholder:text-faint focus:ring-brand/50"
          />
        </div>
      </section>

      {error && <p className="mt-6 rounded-2xl bg-neg-soft p-4 text-sm text-neg">Failed to load launches: {error}</p>}

      {/* token table */}
      <section className="mt-4 overflow-hidden rounded-2xl bg-card ring-1 ring-line">
        <TokenRowHeader />
        {filtered === null
          ? Array.from({ length: 6 }, (_, i) => <TokenRowSkeleton key={i} index={i} />)
          : filtered.map((row, i) => (
              <TokenRow key={row.token} row={row} index={i} startMcUsd6={stats?.startMcUsd6 ?? null} hypeUsd6={hypeUsd6} />
            ))}
        {filtered !== null && filtered.length === 0 && (
          <div className="px-4 py-14 text-center">
            <p className="text-sm text-sub">{query ? 'Nothing matches that search.' : 'No tokens launched yet.'}</p>
            <a
              href="#/launch"
              className="mt-4 inline-block rounded-full bg-brand px-5 py-2.5 text-sm font-bold text-white no-underline transition hover:bg-brand-deep"
            >
              Launch the first token
            </a>
          </div>
        )}
      </section>
    </main>
  )
}

// ------------------------------------------------------------ stat cards

function GradientStat({ tone, label, value, icon }: { tone: 'purple' | 'blue'; label: string; value: string; icon: string }) {
  const bg =
    tone === 'purple'
      ? 'bg-gradient-to-br from-grad-purple-a to-grad-purple-b'
      : 'bg-gradient-to-br from-grad-blue-a to-grad-blue-b'
  return (
    <div className={`flex flex-1 items-center gap-3.5 rounded-2xl px-5 py-4 ${bg}`}>
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-night font-mono text-base font-bold text-white">
        {icon}
      </span>
      <span>
        <span className="block text-xs font-semibold text-sub">{label}</span>
        <span className="block font-mono text-xl font-bold text-ink">{value}</span>
      </span>
    </div>
  )
}

function TopEarningCoins({ rows, hypeUsd6 }: { rows: LaunchRow[] | null; hypeUsd6: bigint | null }) {
  return (
    <div className="rounded-2xl bg-card p-4 ring-1 ring-line">
      <p className="text-xs font-bold text-ink">Top earning coins</p>
      <div className="mt-3 grid grid-cols-4 gap-2">
        {rows === null
          ? Array.from({ length: 4 }, (_, i) => <span key={i} className="shimmer aspect-square rounded-xl" />)
          : rows.map((r) => <EarnerTile key={r.token} row={r} hypeUsd6={hypeUsd6} />)}
        {rows !== null &&
          rows.length < 4 &&
          Array.from({ length: 4 - rows.length }, (_, i) => (
            <a
              key={`empty-${i}`}
              href="#/launch"
              className="flex aspect-square items-center justify-center rounded-xl bg-card-2 text-xl text-faint no-underline ring-1 ring-line transition hover:text-brand"
              title="Launch a token"
            >
              +
            </a>
          ))}
      </div>
    </div>
  )
}

function EarnerTile({ row, hypeUsd6 }: { row: LaunchRow; hypeUsd6: bigint | null }) {
  const [image, setImage] = useState<string | undefined>()
  useEffect(() => {
    let alive = true
    void parseTokenURI(row.tokenURI).then((m) => alive && setImage(m.image))
    return () => {
      alive = false
    }
  }, [row.tokenURI])
  const feesUsd = hypeUsd6 !== null ? (row.lifetimeFeesHype * hypeUsd6) / 10n ** 18n : null
  return (
    <a href={`#/t/${row.token}`} className="group text-center no-underline" title={row.name}>
      <span className="mx-auto block aspect-square overflow-hidden rounded-xl ring-1 ring-line">
        {image ? (
          <img src={image} alt={row.symbol} className="h-full w-full object-cover transition group-hover:scale-105" />
        ) : (
          <span className="flex h-full w-full items-center justify-center bg-card-2 text-lg font-bold text-faint">
            {row.symbol.slice(0, 1)}
          </span>
        )}
      </span>
      <span className="mt-1.5 block truncate text-[11px] font-bold text-ink">{row.symbol}</span>
      <span className="block font-mono text-[10px] text-sub">
        {feesUsd !== null ? formatUsd6(feesUsd) : `${formatUnits18(row.lifetimeFeesHype)}♦`}
      </span>
    </a>
  )
}

function TopMcap({ rows, startMcUsd6 }: { rows: LaunchRow[] | null; startMcUsd6: bigint | null }) {
  return (
    <div className="rounded-2xl bg-night p-4 text-white">
      <p className="text-xs font-bold">Top mcap</p>
      <div className="mt-2.5">
        <div className="grid grid-cols-[1.4fr_1fr_0.8fr] gap-2 border-b border-white/10 pb-1.5 font-mono text-[9px] uppercase tracking-wider text-white/40">
          <span>Coin</span>
          <span>Mcap</span>
          <span className="text-right">Launch</span>
        </div>
        {rows === null ? (
          <div className="space-y-2 pt-2">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="h-7 animate-pulse rounded bg-white/10" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="pt-4 text-center text-xs text-white/40">No tokens yet</p>
        ) : (
          rows.map((r) => (
            <a
              key={r.token}
              href={`#/t/${r.token}`}
              className="grid grid-cols-[1.4fr_1fr_0.8fr] items-center gap-2 border-b border-white/5 py-2 no-underline last:border-0"
            >
              <span className="flex min-w-0 items-center gap-2">
                <TokenImage symbol={r.symbol} size="xs" src={undefined} />
                <span className="truncate text-xs font-bold text-white">{r.symbol}</span>
              </span>
              <span className="font-mono text-xs text-white/90">{formatUsd6(r.marketCapUsd6)}</span>
              <span className="text-right">
                <PerfBadge mcapUsd6={r.marketCapUsd6} startMcUsd6={startMcUsd6} />
              </span>
            </a>
          ))
        )}
      </div>
    </div>
  )
}
