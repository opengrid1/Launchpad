import { useMemo, useState } from 'react'
import { useLaunches, usePlatformStats } from '../hooks/useLaunches'
import { TokenCard, TokenCardSkeleton } from '../components/TokenCard'
import { formatUsd6 } from '../lib/format'

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
          (r) =>
            r.name.toLowerCase().includes(q) ||
            r.symbol.toLowerCase().includes(q) ||
            r.token.toLowerCase() === q,
        )
      : rows
    const sorted = [...matched]
    if (sort === 'mcap') sorted.sort((a, b) => (b.marketCapUsd6 > a.marketCapUsd6 ? 1 : -1))
    if (sort === 'fees') sorted.sort((a, b) => (b.lifetimeFeesHype > a.lifetimeFeesHype ? 1 : -1))
    return sorted
  }, [rows, query, sort])

  const totals = useMemo(() => {
    if (!rows) return null
    const mcap = rows.reduce((acc, r) => acc + r.marketCapUsd6, 0n)
    return { count: rows.length, mcap }
  }, [rows])

  return (
    <main>
      {/* hero */}
      <section className="mt-3 overflow-hidden rounded-3xl bg-gradient-to-br from-ink-850 to-ink-900 p-6 ring-1 ring-ink-700 sm:p-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-lg">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-mint-400">no curve · no presale</p>
            <h1 className="mt-2 text-3xl font-bold leading-tight tracking-tight text-fog-100">
              Launch flat.
              <br />
              Trade from block one.
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-fog-300">
              Every token lists straight into a HyperSwap V3 pool at a{' '}
              <span className="font-mono text-mint-400">{stats ? formatUsd6(stats.startMcUsd6) : '$4,000'}</span> market
              cap. Creators keep <span className="font-mono text-mint-400">70%</span> of every trade's fee — forever.
            </p>
            <a
              href="#/launch"
              className="mt-5 inline-block rounded-xl bg-mint-500 px-6 py-3 text-sm font-semibold text-ink-950 no-underline transition hover:bg-mint-400"
            >
              Launch a token →
            </a>
          </div>
          <dl className="flex gap-8 font-mono sm:flex-col sm:gap-4 sm:text-right">
            <HeroStat label="tokens launched" value={totals ? String(totals.count) : '·'} />
            <HeroStat label="combined mcap" value={totals ? formatUsd6(totals.mcap) : '·'} />
            <HeroStat
              label="HYPE price"
              value={stats ? `$${(Number(stats.hypeUsd6) / 1e6).toFixed(2)}` : '·'}
              live
            />
          </dl>
        </div>
      </section>

      {/* controls */}
      <section className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <svg
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2"
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
          >
            <circle cx="6" cy="6" r="4.5" stroke="var(--color-fog-500)" strokeWidth="1.5" />
            <path d="M9.5 9.5 L13 13" stroke="var(--color-fog-500)" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, symbol or address…"
            className="w-full rounded-xl bg-ink-850 py-2.5 pl-9 pr-4 text-sm text-fog-100 ring-1 ring-ink-700 outline-none transition placeholder:text-fog-500 focus:ring-mint-500/50"
          />
        </div>
        <div className="flex gap-1 self-start rounded-full bg-ink-850/80 p-1 ring-1 ring-ink-700">
          {(
            [
              ['Newest', 'new'],
              ['Market cap', 'mcap'],
              ['Top earners', 'fees'],
            ] as const
          ).map(([label, key]) => (
            <button
              key={key}
              onClick={() => setSort(key)}
              className={`cursor-pointer rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                sort === key ? 'bg-mint-500/15 text-mint-300' : 'text-fog-300 hover:text-fog-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {error && (
        <p className="mt-8 rounded-xl bg-rose-soft/10 p-4 text-sm text-rose-soft ring-1 ring-rose-soft/30">
          Failed to load launches: {error}
        </p>
      )}

      <section className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered === null
          ? Array.from({ length: 6 }, (_, i) => <TokenCardSkeleton key={i} index={i} />)
          : filtered.map((row, i) => (
              <TokenCard key={row.token} row={row} index={i} startMcUsd6={stats?.startMcUsd6 ?? null} />
            ))}
      </section>

      {filtered !== null && filtered.length === 0 && (
        <div className="mt-16 text-center">
          <p className="text-fog-300">{query ? 'Nothing matches that search.' : 'No tokens launched yet.'}</p>
          <a
            href="#/launch"
            className="mt-4 inline-block rounded-xl bg-mint-500 px-5 py-2.5 text-sm font-semibold text-ink-950 no-underline transition hover:bg-mint-400"
          >
            Be the first to launch
          </a>
        </div>
      )}
    </main>
  )
}

function HeroStat({ label, value, live }: { label: string; value: string; live?: boolean }) {
  return (
    <div>
      <dd key={value} className={`text-xl font-semibold text-fog-100 ${live ? 'ticker-flash' : ''}`}>
        {value}
      </dd>
      <dt className="mt-0.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-fog-500 sm:justify-end">
        {live && <span className="live-dot h-1 w-1 rounded-full bg-mint-400" />}
        {label}
      </dt>
    </div>
  )
}
