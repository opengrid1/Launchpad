import { useState } from 'react'
import { LAUNCHES, type LaunchStatus } from '../data/launches'
import { LaunchCard } from '../components/LaunchCard'

type Filter = 'all' | LaunchStatus

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Trending' },
  { key: 'live', label: 'Live' },
  { key: 'upcoming', label: 'Opening' },
]

export function Explore({ onOpen }: { onOpen: (id: number) => void }) {
  const [filter, setFilter] = useState<Filter>('all')
  const shown = LAUNCHES.filter((l) => filter === 'all' || l.status === filter)

  // king of the hill: the live coin with the most volume
  const king = LAUNCHES.filter((l) => l.status === 'live').sort((a, b) => b.volume - a.volume)[0] ?? LAUNCHES[0]

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

      {/* sort tabs + new coin */}
      <div className="mt-8 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 overflow-x-auto">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`cursor-pointer whitespace-nowrap rounded-full px-4 py-2 text-[13px] font-medium transition ${
                filter === f.key ? 'bg-ink text-paper' : 'bg-surface text-ink-2 ring-1 ring-line hover:text-ink'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="tnum hidden shrink-0 text-[12px] text-ink-3 sm:block">{shown.length} coins</span>
      </div>

      {/* board */}
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((l, i) => (
          <LaunchCard key={l.id} launch={l} index={i} onOpen={() => onOpen(l.id)} />
        ))}
      </div>
    </main>
  )
}
