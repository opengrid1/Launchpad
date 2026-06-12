import { useMemo, useState } from 'react'
import { useLaunches } from '../hooks/useLaunches'
import { TokenCard, TokenCardSkeleton } from '../components/TokenCard'
import { formatUsd6 } from '../lib/format'

type SortKey = 'new' | 'mcap' | 'fees'

export function Board() {
  const { rows, error } = useLaunches()
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
      <section className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-fog-100">Live tokens</h1>
          <p className="mt-1 text-sm text-fog-300">
            Every token launches at a <span className="font-mono text-mint-400">$4,000</span> market cap, straight into a
            HyperSwap V3 pool. No curve, no presale — trading from block one.
          </p>
        </div>
        {totals && (
          <div className="flex gap-6 font-mono text-xs text-fog-500">
            <span>
              <span className="block text-lg font-semibold text-fog-100">{totals.count}</span>launched
            </span>
            <span>
              <span className="block text-lg font-semibold text-fog-100">{formatUsd6(totals.mcap)}</span>combined mcap
            </span>
          </div>
        )}
      </section>

      <section className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, symbol or address…"
          className="w-full rounded-xl bg-ink-850 px-4 py-2.5 text-sm text-fog-100 ring-1 ring-ink-700 outline-none transition placeholder:text-fog-500 focus:ring-mint-500/50 sm:max-w-xs"
        />
        <div className="flex gap-1 rounded-full bg-ink-850/80 p-1 ring-1 ring-ink-700">
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

      <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered === null
          ? Array.from({ length: 6 }, (_, i) => <TokenCardSkeleton key={i} index={i} />)
          : filtered.map((row, i) => <TokenCard key={row.token} row={row} index={i} />)}
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
