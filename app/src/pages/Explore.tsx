import { useState } from 'react'
import { LAUNCHES, ageHours, supplyOf } from '../data/launches'
import { LaunchCard } from '../components/LaunchCard'

type Sort = 'trending' | 'top' | 'new'

const SORTS: { key: Sort; label: string }[] = [
  { key: 'trending', label: 'Trending' },
  { key: 'top', label: 'Top' },
  { key: 'new', label: 'New' },
]

export function Explore({ onOpen }: { onOpen: (id: number) => void }) {
  const [sort, setSort] = useState<Sort>('trending')

  const coins = [...LAUNCHES].sort((a, b) => {
    if (sort === 'top') return b.priceEth * supplyOf(b) - a.priceEth * supplyOf(a)
    if (sort === 'new') return ageHours(a.createdAgo) - ageHours(b.createdAgo)
    return b.volume - a.volume // trending
  })

  // king of the hill: the coin with the most volume
  const king = [...LAUNCHES].sort((a, b) => b.volume - a.volume)[0]

  return (
    <main className="pb-24">
      {/* king of the hill */}
      <section className="rise-in pt-6">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[15px]">👑</span>
          <span className="eyebrow text-gold">King of the hill</span>
        </div>
        <div className="sm:max-w-2xl">
          <LaunchCard launch={king} index={0} featured onOpen={() => onOpen(king.id)} />
        </div>
      </section>

      {/* sort tabs */}
      <div className="mt-8 flex items-center justify-between gap-3">
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
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {coins.map((l, i) => (
          <LaunchCard key={l.id} launch={l} index={i} onOpen={() => onOpen(l.id)} />
        ))}
      </div>
    </main>
  )
}
