import { useState } from 'react'
import { LAUNCHES, compact, rewardSplit, type LaunchStatus } from '../data/launches'
import { LaunchCard } from '../components/LaunchCard'

type Filter = 'all' | LaunchStatus

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'live', label: 'Live' },
  { key: 'upcoming', label: 'Opens soon' },
  { key: 'graduated', label: 'Graduated' },
  { key: 'refunding', label: 'Refunding' },
]

export function Explore({ onOpen, onCreate }: { onOpen: (id: number) => void; onCreate: () => void }) {
  const [filter, setFilter] = useState<Filter>('all')
  const shown = LAUNCHES.filter((l) => filter === 'all' || l.status === filter)
  const totalPaid = LAUNCHES.reduce((s, l) => s + l.rewardsPaid, 0)
  const toHolders = LAUNCHES.reduce((s, l) => s + rewardSplit(l).toHolders, 0)
  const liveCount = LAUNCHES.filter((l) => l.status === 'live').length

  return (
    <main>
      {/* hero — editorial, left-weighted, one accent */}
      <section className="rise-in grid gap-10 py-14 lg:grid-cols-[1.1fr_0.9fr] lg:py-20">
        <div className="max-w-xl">
          <p className="text-[13px] font-medium tracking-tight text-emerald">A launchpad that pays the room</p>
          <h1 className="mt-4 font-display text-[44px] font-semibold leading-[0.98] tracking-tight sm:text-[56px]">
            Half to the holders.
            <br />
            Half back to you.
          </h1>
          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-ink-2">
            Fixed-price token launches on Robinhood Chain. Once a token graduates, every trade pays a small
            fee — and it splits down the middle: half to everyone holding, half rebated to the trader who
            made the swap.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <button
              onClick={onCreate}
              className="cursor-pointer rounded-lg bg-ink px-5 py-2.5 text-sm font-medium text-paper transition hover:bg-emerald-strong"
            >
              Launch a token
            </button>
            <button
              onClick={() => setFilter('live')}
              className="cursor-pointer rounded-lg border border-line px-5 py-2.5 text-sm font-medium text-ink transition hover:border-line-2"
            >
              Browse live sales
            </button>
          </div>
        </div>

        {/* a small, precise fact panel instead of a decorative graphic */}
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line lg:self-center">
          {[
            ['Paid out to date', `${compact(totalPaid)} RBH`],
            ['To holders', `${compact(toHolders)} RBH`],
            ['Live sales', String(liveCount)],
            ['The split', '50 / 50'],
          ].map(([k, v]) => (
            <div key={k} className="bg-surface p-5">
              <p className="tnum text-2xl font-semibold tracking-tight text-ink">{v}</p>
              <p className="mt-1 text-[13px] text-ink-3">{k}</p>
            </div>
          ))}
        </div>
      </section>

      {/* filters */}
      <div className="flex items-center justify-between border-b border-line pb-4">
        <div className="flex items-center gap-5 overflow-x-auto">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`cursor-pointer whitespace-nowrap text-[13px] font-medium transition ${
                filter === f.key ? 'text-ink' : 'text-ink-3 hover:text-ink'
              }`}
            >
              {f.label}
              {filter === f.key && <span className="mt-1 block h-px bg-ink" />}
            </button>
          ))}
        </div>
        <span className="hidden text-[13px] text-ink-3 sm:block">{shown.length} launches</span>
      </div>

      <div className="mt-6 grid gap-5 pb-24 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((l, i) => (
          <LaunchCard key={l.id} launch={l} index={i} onOpen={() => onOpen(l.id)} />
        ))}
      </div>
    </main>
  )
}
