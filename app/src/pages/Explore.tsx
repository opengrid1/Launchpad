import { useState } from 'react'
import { ageHours, supplyOf, type Launch } from '../data/launches'
import { LaunchCard } from '../components/LaunchCard'

type Sort = 'trending' | 'top' | 'new'

const SORTS: { key: Sort; label: string }[] = [
  { key: 'trending', label: 'Trending' },
  { key: 'top', label: 'Top' },
  { key: 'new', label: 'New' },
]

export function Explore({ coins: all, query = '', onOpen }: { coins: Launch[]; query?: string; onOpen: (address: string) => void }) {
  const [sort, setSort] = useState<Sort>('trending')

  const q = query.trim().toLowerCase()
  const filtered = q
    ? all.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.symbol.toLowerCase().includes(q) ||
          c.tokenAddress.toLowerCase().includes(q),
      )
    : all

  const coins = [...filtered].sort((a, b) => {
    if (sort === 'top') return b.priceEth * supplyOf(b) - a.priceEth * supplyOf(a)
    if (sort === 'new') return ageHours(a.createdAgo) - ageHours(b.createdAgo)
    return b.volume - a.volume // trending
  })

  // king of the hill: the coin with the most volume
  const king = [...all].sort((a, b) => b.volume - a.volume)[0]

  if (all.length === 0) {
    return (
      <main className="pb-24">
        <div className="rise-in flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
          <span className="text-[28px]">🪶</span>
          <p className="font-display text-[18px] font-bold text-ink">Loading live coins…</p>
          <p className="max-w-sm text-[13px] leading-relaxed text-ink-3">
            Reading launches from the Loxley launchpad on Robinhood Chain. If nothing appears,
            no coins have launched yet — be the first with “Create coin”.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="pb-24">
      {/* king of the hill — hidden while searching */}
      {!q && king && (
        <section className="rise-in pt-6">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[15px]">👑</span>
            <span className="eyebrow text-gold">King of the hill</span>
          </div>
          <div className="sm:max-w-2xl">
            <LaunchCard launch={king} index={0} featured onOpen={() => onOpen(king.tokenAddress)} />
          </div>
        </section>
      )}

      {/* sort tabs */}
      <div className={`flex items-center justify-between gap-3 ${q ? 'pt-6' : 'mt-8'}`}>
        <div className="flex items-center gap-2 overflow-x-auto">
          {SORTS.map((f) => (
            <button
              key={f.key}
              onClick={() => setSort(f.key)}
              className={`cursor-pointer whitespace-nowrap rounded-full px-4 py-2 text-[13px] font-medium transition ${
                sort === f.key ? 'bg-ink text-paper' : 'bg-surface text-ink-2 ring-1 ring-line hover:text-ink'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="tnum hidden shrink-0 text-[12px] text-ink-3 sm:block">{coins.length} coins</span>
      </div>

      {/* board */}
      {coins.length === 0 ? (
        <p className="mt-10 text-center text-[13px] text-ink-3">
          No coins match “{query.trim()}”.
        </p>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {coins.map((l, i) => (
            <LaunchCard key={l.id} launch={l} index={i} onOpen={() => onOpen(l.tokenAddress)} />
          ))}
        </div>
      )}
    </main>
  )
}
