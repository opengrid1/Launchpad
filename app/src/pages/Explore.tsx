import { useState } from 'react'
import { LAUNCHES, compact, rewardSplit, type LaunchStatus } from '../data/launches'
import { LaunchCard } from '../components/LaunchCard'

type Filter = 'all' | LaunchStatus

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'live', label: 'Live' },
  { key: 'upcoming', label: 'Opening' },
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
      {/* hero — editorial, asymmetric, serif-led */}
      <section className="rise-in max-w-3xl py-10 sm:py-16">
        <p className="eyebrow">A launchpad on Robinhood Chain</p>
        <h1 className="font-display mt-5 text-[46px] font-normal leading-[1.02] tracking-tight sm:text-[68px]">
          Half to the holders.
          <br />
          Half back to <span className="italic text-emerald-strong">you</span>.
        </h1>
        <p className="mt-6 max-w-xl text-[16px] leading-relaxed text-ink-2">
          Tokens launch at one flat price — no curve, no early-buyer edge. When a sale graduates, every
          trade after it pays a small fee that splits down the middle: half shared out to everyone holding,
          half rebated to the trader who made the swap.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-6">
          <button
            onClick={onCreate}
            className="cursor-pointer rounded-full bg-ink px-6 py-2.5 text-[14px] font-medium text-paper transition hover:bg-emerald-strong"
          >
            Start a launch
          </button>
          <button
            onClick={() => setFilter('live')}
            className="cursor-pointer text-[14px] text-ink-2 underline decoration-line-2 underline-offset-4 transition-colors hover:text-ink hover:decoration-emerald"
          >
            or browse what's live
          </button>
        </div>
      </section>

      {/* three figures, divided by hairlines — not tiles */}
      <section className="rule-t flex flex-wrap gap-y-6 py-8">
        {[
          ['Paid out so far', `${compact(totalPaid)}`, 'RBH across every graduated launch'],
          ['Of that, to holders', `${compact(toHolders)}`, 'the top half of every split'],
          ['Live right now', String(liveCount), liveCount === 1 ? 'sale taking buys' : 'sales taking buys'],
        ].map(([label, value, sub], i) => (
          <div key={label} className={`min-w-[180px] flex-1 ${i > 0 ? 'sm:border-l sm:border-line sm:pl-8' : ''}`}>
            <p className="eyebrow">{label}</p>
            <p className="font-display tnum mt-2 text-[34px] font-medium leading-none text-ink">{value}</p>
            <p className="mt-2 text-[12px] text-ink-3">{sub}</p>
          </div>
        ))}
      </section>

      {/* filters + list */}
      <section className="rule-t pt-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-5 overflow-x-auto">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`cursor-pointer whitespace-nowrap text-[14px] transition-colors ${
                  filter === f.key ? 'text-ink' : 'text-ink-3 hover:text-ink-2'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <span className="eyebrow hidden sm:block">{shown.length} shown</span>
        </div>

        <div className="mt-4 grid gap-x-10 gap-y-1 divide-y divide-line pb-24 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-2">
          {shown.map((l, i) => (
            <LaunchCard key={l.id} launch={l} index={i} onOpen={() => onOpen(l.id)} />
          ))}
        </div>
      </section>
    </main>
  )
}
