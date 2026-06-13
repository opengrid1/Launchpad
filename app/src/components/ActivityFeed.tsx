import { useEffect, useState } from 'react'
import type { LaunchRow } from '../lib/launchpad'
import { fetchTrades } from '../lib/gecko'
import { compactNumber, shortAddress, timeAgo } from '../lib/format'

type Item = { token: string; symbol: string; kind: 'buy' | 'sell'; usd: number; from: string; ts: number; txHash: string }

/** Live cross-market activity — recent buys/sells across all launches, auto-updating. */
export function ActivityFeed({ rows }: { rows: LaunchRow[] }) {
  const [items, setItems] = useState<Item[] | null>(null)
  const poolKey = rows.map((r) => r.pool).join(',')

  useEffect(() => {
    if (rows.length === 0) return
    let alive = true
    const load = async () => {
      const pools = rows.slice(0, 8) // newest few markets
      const results = await Promise.all(
        pools.map((r) =>
          fetchTrades(r.pool).then((ts) =>
            ts.map<Item>((t) => ({ token: r.token, symbol: r.symbol, kind: t.kind, usd: t.usd, from: t.from, ts: t.ts, txHash: t.txHash })),
          ),
        ),
      )
      const merged = results.flat().sort((a, b) => b.ts - a.ts).slice(0, 20)
      if (alive) setItems(merged)
    }
    void load()
    const id = window.setInterval(load, 15_000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolKey])

  return (
    <section className="elev overflow-hidden rounded-2xl ring-1 ring-hair">
      <div className="flex items-center gap-2 border-b border-hair px-4 py-3">
        <span className="live-dot h-1.5 w-1.5 rounded-full bg-acc" />
        <h2 className="text-sm font-semibold text-fg">Live activity</h2>
      </div>
      <div className="max-h-[360px] overflow-y-auto">
        {items === null ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="shimmer h-9 rounded-lg" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="px-4 py-10 text-center font-mono text-xs text-ghost">No trades yet</p>
        ) : (
          items.map((it, i) => (
            <a
              key={`${it.txHash}-${i}`}
              href={`#/t/${it.token}`}
              className={`rise-in flex items-center justify-between gap-2 px-4 py-2.5 no-underline transition-colors hover:bg-panel2/60 ${i > 0 ? 'border-t border-hair/60' : ''}`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className={`font-mono text-[11px] font-bold ${it.kind === 'buy' ? 'text-up' : 'text-down'}`}>
                  {it.kind === 'buy' ? 'BUY' : 'SELL'}
                </span>
                <span className="truncate font-mono text-xs font-semibold text-fg">${it.symbol}</span>
                <span className="font-mono text-[11px] text-ghost">{shortAddress(it.from)}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2 font-mono text-[11px]">
                <span className="text-fg">${it.usd < 0.01 ? it.usd.toPrecision(2) : compactNumber(it.usd)}</span>
                <span className="text-ghost">{it.ts ? timeAgo(it.ts) : ''}</span>
              </span>
            </a>
          ))
        )}
      </div>
    </section>
  )
}
