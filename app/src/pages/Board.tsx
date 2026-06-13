import { useEffect, useMemo, useState } from 'react'
import { useLaunches, usePlatformStats } from '../hooks/useLaunches'
import { TokenRow, TokenRowHeader, TokenRowSkeleton } from '../components/TokenRow'
import { HeroBanner } from '../components/HeroBanner'
import { fetchVolumes, fetchSparklines } from '../lib/gecko'
import { formatUsd6 } from '../lib/format'
import type { LaunchRow } from '../lib/launchpad'

type SortKey = 'new' | 'top' | 'mcap' | 'vol' | 'fees'

export function Board() {
  const { rows, error } = useLaunches()
  const stats = usePlatformStats()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('new')
  const [volumes, setVolumes] = useState<Record<string, number>>({})
  const [sparks, setSparks] = useState<Record<string, number[]>>({})

  // 24h volume + sparkline series per pool from GeckoTerminal (no on-chain volume exists).
  const poolKey = rows?.map((r) => r.pool).join(',') ?? ''
  useEffect(() => {
    if (!rows || rows.length === 0) return
    let alive = true
    const pools = rows.map((r) => r.pool)
    const loadVol = () => fetchVolumes(pools).then((v) => alive && setVolumes(v))
    const loadSpark = () => fetchSparklines(pools).then((s) => alive && setSparks(s))
    void loadVol()
    void loadSpark()
    const vId = window.setInterval(loadVol, 30_000)
    const sId = window.setInterval(loadSpark, 60_000)
    return () => {
      alive = false
      window.clearInterval(vId)
      window.clearInterval(sId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolKey])

  const startMc6 = stats?.startMcUsd6 ?? null
  const vol = (r: LaunchRow) => volumes[r.pool.toLowerCase()] ?? 0
  const perf = (r: LaunchRow) => (startMc6 && startMc6 > 0n ? Number(r.marketCapUsd6) / Number(startMc6) : 0)

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
    if (sort === 'vol') sorted.sort((a, b) => vol(b) - vol(a))
    if (sort === 'top') sorted.sort((a, b) => perf(b) - perf(a))
    return sorted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, query, sort, volumes, startMc6])

  const hypeUsd6 = stats?.hypeUsd6 ?? null

  const metrics = useMemo(() => {
    if (!rows || !hypeUsd6) return null
    const totalFeesHype = rows.reduce((acc, r) => acc + r.lifetimeFeesHype, 0n)
    const creatorEarningsUsd = (((totalFeesHype * 7000n) / 10000n) * hypeUsd6) / 10n ** 18n
    const combinedMcap = rows.reduce((acc, r) => acc + r.marketCapUsd6, 0n)
    const vol24 = Object.values(volumes).reduce((a, b) => a + b, 0)
    return [
      ['24h volume', `$${fmt(vol24)}`, true],
      ['Combined mcap', formatUsd6(combinedMcap), false],
      ['Active tokens', String(rows.length), false],
      ['HYPE price', `$${(Number(hypeUsd6) / 1e6).toFixed(2)}`, false],
      ['Creator earnings', formatUsd6(creatorEarningsUsd), false],
    ] as const
  }, [rows, hypeUsd6, volumes])

  return (
    <main>
      <HeroBanner />

      {/* ecosystem stats — minimal strip, no scroll */}
      <section className="mt-8 grid grid-cols-3 gap-x-5 gap-y-3 border-y border-hair py-3.5 sm:flex sm:items-center sm:gap-0">
        {(metrics ?? Array.from({ length: 5 }, () => null)).map((m, i) => (
          <div key={i} className={`min-w-0 sm:flex-1 sm:px-5 ${i > 0 ? 'sm:border-l sm:border-hair' : ''}`}>
            {m === null ? (
              <>
                <div className="shimmer h-2.5 w-14 rounded" />
                <div className="shimmer mt-1.5 h-3.5 w-16 rounded" />
              </>
            ) : (
              <>
                <p className="flex items-center gap-1 truncate text-[10px] font-medium uppercase tracking-wide text-ghost">
                  {m[2] && <span className="live-dot h-1 w-1 shrink-0 rounded-full bg-acc" />}
                  {m[0]}
                </p>
                <p key={m[1]} className="ticker-flash mt-0.5 truncate font-mono text-sm font-semibold text-fg">
                  {m[1]}
                </p>
              </>
            )}
          </div>
        ))}
      </section>

      {/* tabs + search */}
      <section className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="no-scrollbar -mx-4 flex gap-0.5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          {(
            [
              ['All', 'new'],
              ['Top performers', 'top'],
              ['Trending', 'vol'],
              ['Mcap', 'mcap'],
              ['Fees', 'fees'],
            ] as const
          ).map(([label, key]) => (
            <button
              key={key}
              onClick={() => setSort(key)}
              className={`relative shrink-0 cursor-pointer rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors after:absolute after:inset-x-3.5 after:-bottom-px after:h-0.5 after:rounded-full after:bg-acc after:transition-opacity ${
                sort === key ? 'text-acc after:opacity-100' : 'text-ghost after:opacity-0 hover:text-dim'
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
            placeholder="Search tokens"
            className="w-full rounded-lg bg-panel py-2 pl-8.5 pr-3 text-sm text-fg ring-1 ring-hair outline-none transition placeholder:text-ghost focus:ring-acc/50"
          />
        </div>
      </section>

      {error && <p className="mt-4 rounded-xl bg-downsoft p-4 font-mono text-xs text-down">{error}</p>}

      {/* full-width markets table */}
      <section className="elev mt-3 overflow-hidden rounded-2xl ring-1 ring-hair">
        <TokenRowHeader />
        {filtered === null
          ? Array.from({ length: 8 }, (_, i) => <TokenRowSkeleton key={i} index={i} />)
          : filtered.map((row, i) => (
              <TokenRow
                key={row.token}
                row={row}
                index={i}
                startMcUsd6={startMc6}
                hypeUsd6={hypeUsd6}
                volume={volumes[row.pool.toLowerCase()]}
                sparkline={sparks[row.pool.toLowerCase()]}
              />
            ))}
        {filtered !== null && filtered.length === 0 && (
          <div className="px-4 py-16 text-center">
            <p className="font-mono text-sm text-ghost">{query ? 'No results' : 'No tokens yet'}</p>
            {!query && (
              <a href="#/launch" className="btn-primary mt-4 inline-block rounded-lg px-5 py-2.5 text-sm font-semibold no-underline">
                Launch
              </a>
            )}
          </div>
        )}
      </section>
    </main>
  )
}

function fmt(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}
