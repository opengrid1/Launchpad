import { useMemo, useState } from 'react'
import { useLaunches, usePlatformStats } from '../hooks/useLaunches'
import { TokenRow, TokenRowHeader, TokenRowSkeleton } from '../components/TokenRow'
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
          (r) => r.name.toLowerCase().includes(q) || r.symbol.toLowerCase().includes(q) || r.token.toLowerCase() === q,
        )
      : rows
    const sorted = [...matched]
    if (sort === 'mcap') sorted.sort((a, b) => (b.marketCapUsd6 > a.marketCapUsd6 ? 1 : -1))
    if (sort === 'fees') sorted.sort((a, b) => (b.lifetimeFeesHype > a.lifetimeFeesHype ? 1 : -1))
    return sorted
  }, [rows, query, sort])

  const hypeUsd6 = stats?.hypeUsd6 ?? null

  const tape = useMemo(() => {
    if (!rows || !hypeUsd6) return null
    const totalFeesHype = rows.reduce((acc, r) => acc + r.lifetimeFeesHype, 0n)
    const creatorEarningsUsd = (((totalFeesHype * 7000n) / 10000n) * hypeUsd6) / 10n ** 18n
    const combinedMcap = rows.reduce((acc, r) => acc + r.marketCapUsd6, 0n)
    return [
      ['HYPE', `$${(Number(hypeUsd6) / 1e6).toFixed(2)}`],
      ['Tokens', String(rows.length)],
      ['Combined mcap', formatUsd6(combinedMcap)],
      ['Creator earnings', formatUsd6(creatorEarningsUsd)],
      ['Launch mcap', stats ? formatUsd6(stats.startMcUsd6) : '—'],
    ] as const
  }, [rows, hypeUsd6, stats])

  return (
    <main>
      {/* market tape */}
      <section className="no-scrollbar -mx-4 mt-0 overflow-x-auto border-b border-hair px-4 sm:-mx-6 sm:px-6">
        <div className="flex min-w-max items-center gap-8 py-3 font-mono text-xs">
          <span className="live-dot h-1.5 w-1.5 shrink-0 rounded-full bg-acc" />
          {tape === null
            ? Array.from({ length: 5 }, (_, i) => <span key={i} className="shimmer h-3.5 w-28 rounded" />)
            : tape.map(([label, value]) => (
                <span key={label} className="flex items-baseline gap-2">
                  <span className="uppercase tracking-[0.14em] text-ghost">{label}</span>
                  <span key={value} className="ticker-flash text-fg">{value}</span>
                </span>
              ))}
        </div>
      </section>

      {/* heading + controls */}
      <section className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-fg">Board</h1>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            {(
              [
                ['New', 'new'],
                ['Mcap', 'mcap'],
                ['Fees', 'fees'],
              ] as const
            ).map(([label, key]) => (
              <button
                key={key}
                onClick={() => setSort(key)}
                className={`shrink-0 cursor-pointer rounded-lg px-3.5 py-2 text-xs font-bold transition ${
                  sort === key ? 'bg-accsoft text-acc' : 'text-ghost ring-1 ring-hair hover:text-dim'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="relative w-full sm:w-64">
            <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" width="13" height="13" viewBox="0 0 14 14" fill="none">
              <circle cx="6" cy="6" r="4.5" stroke="var(--color-ghost)" strokeWidth="1.5" />
              <path d="M9.5 9.5 L13 13" stroke="var(--color-ghost)" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input
              id="board-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              className="w-full rounded-lg bg-panel py-2 pl-8.5 pr-3 text-sm text-fg ring-1 ring-hair outline-none transition placeholder:text-ghost focus:ring-acc/50"
            />
          </div>
        </div>
      </section>

      {error && <p className="mt-6 rounded-xl bg-downsoft p-4 font-mono text-xs text-down">{error}</p>}

      {/* table */}
      <section className="mt-4 overflow-hidden rounded-2xl bg-panel ring-1 ring-hair">
        <TokenRowHeader />
        {filtered === null
          ? Array.from({ length: 6 }, (_, i) => <TokenRowSkeleton key={i} index={i} />)
          : filtered.map((row, i) => (
              <TokenRow key={row.token} row={row} index={i} startMcUsd6={stats?.startMcUsd6 ?? null} hypeUsd6={hypeUsd6} />
            ))}
        {filtered !== null && filtered.length === 0 && (
          <div className="px-4 py-16 text-center">
            <p className="font-mono text-sm text-ghost">{query ? 'No results' : 'No tokens yet'}</p>
            {!query && (
              <a
                href="#/launch"
                className="mt-4 inline-block rounded-lg bg-acc px-5 py-2.5 text-sm font-bold text-base no-underline transition hover:bg-accdeep"
              >
                Launch
              </a>
            )}
          </div>
        )}
      </section>
    </main>
  )
}
