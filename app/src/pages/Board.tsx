import { useEffect, useMemo, useState } from 'react'
import { useLaunches, usePlatformStats } from '../hooks/useLaunches'
import { TokenRow, TokenRowHeader, TokenRowSkeleton, Delta } from '../components/TokenRow'
import { ActivityFeed } from '../components/ActivityFeed'
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

  const topPerformers = useMemo(() => {
    if (!rows) return null
    return [...rows].filter((r) => !r.positionWithdrawn).sort((a, b) => perf(b) - perf(a)).slice(0, 5)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, startMc6])

  return (
    <main>
      {/* hero */}
      <section className="mt-10 text-center sm:mt-14">
        <h1 className="mx-auto max-w-2xl text-3xl font-bold leading-[1.1] tracking-tight text-fg sm:text-5xl">
          Launch &amp; trade tokens on <span className="text-acc">HyperEVM</span>
        </h1>
        <p className="mx-auto mt-4 max-w-lg text-sm leading-relaxed text-dim sm:text-base">
          Every launch is a live market on a single HyperSwap V3 pool. Buy and sell instantly — no bonding curve, no presale.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <a href="#/launch" className="btn-primary rounded-xl px-6 py-2.5 text-sm font-semibold no-underline">
            Launch a token
          </a>
          <a href="#/docs" className="rounded-xl px-5 py-2.5 text-sm font-semibold text-dim no-underline ring-1 ring-hair transition hover:text-fg hover:ring-hair2">
            How it works
          </a>
        </div>
      </section>

      {/* ecosystem stats — inline bar with dividers */}
      <section className="elev no-scrollbar mt-9 flex overflow-x-auto rounded-2xl ring-1 ring-hair">
        {metrics === null
          ? Array.from({ length: 5 }, (_, i) => (
              <div key={i} className={`min-w-[46%] flex-1 px-5 py-4 sm:min-w-0 ${i > 0 ? 'border-l border-hair' : ''}`}>
                <div className="shimmer h-3 w-20 rounded" />
                <div className="shimmer mt-2 h-5 w-24 rounded" />
              </div>
            ))
          : metrics.map(([label, value, live], i) => (
              <div key={label} className={`min-w-[46%] flex-1 px-5 py-4 sm:min-w-0 ${i > 0 ? 'border-l border-hair' : ''}`}>
                <p className="flex items-center gap-1.5 text-[11px] font-medium text-ghost">
                  {live && <span className="live-dot h-1.5 w-1.5 rounded-full bg-acc" />}
                  {label}
                </p>
                <p key={value} className="ticker-flash mt-1.5 truncate font-mono text-xl font-semibold tracking-tight text-fg">
                  {value}
                </p>
              </div>
            ))}
      </section>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
        {/* markets */}
        <div className="min-w-0">
          <section className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              {(
                [
                  ['New', 'new'],
                  ['Trending', 'top'],
                  ['Mcap', 'mcap'],
                  ['Volume', 'vol'],
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
            <div className="relative w-full sm:w-56">
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
          </section>

          {error && <p className="mt-4 rounded-xl bg-downsoft p-4 font-mono text-xs text-down">{error}</p>}

          <section className="elev mt-4 overflow-hidden rounded-2xl ring-1 ring-hair">
            <TokenRowHeader />
            {filtered === null
              ? Array.from({ length: 6 }, (_, i) => <TokenRowSkeleton key={i} index={i} />)
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
        </div>

        {/* right rail */}
        <aside className="space-y-5">
          <TopPerformers rows={topPerformers} startMc6={startMc6} />
          {rows && rows.length > 0 && <ActivityFeed rows={rows} />}
        </aside>
      </div>
    </main>
  )
}

function TopPerformers({ rows, startMc6 }: { rows: LaunchRow[] | null; startMc6: bigint | null }) {
  return (
    <section className="elev overflow-hidden rounded-2xl ring-1 ring-hair">
      <div className="border-b border-hair px-4 py-3">
        <h2 className="text-sm font-semibold text-fg">Top performers</h2>
      </div>
      {rows === null ? (
        <div className="space-y-2 p-3">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="shimmer h-8 rounded-lg" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="px-4 py-8 text-center font-mono text-xs text-ghost">No tokens yet</p>
      ) : (
        rows.map((r, i) => (
          <a
            key={r.token}
            href={`#/t/${r.token}`}
            className={`flex items-center justify-between gap-2 px-4 py-2.5 no-underline transition-colors hover:bg-panel2/60 ${i > 0 ? 'border-t border-hair/60' : ''}`}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="font-mono text-[11px] text-ghost">{i + 1}</span>
              <span className="truncate text-sm font-semibold text-fg">${r.symbol}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2.5">
              <span className="font-mono text-xs text-dim">{formatUsd6(r.marketCapUsd6)}</span>
              <Delta mcapUsd6={r.marketCapUsd6} startMcUsd6={startMc6} />
            </span>
          </a>
        ))
      )}
    </section>
  )
}

function fmt(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}
