import { useState } from 'react'
import { LAUNCHES, compact, rewardSplit, type LaunchStatus } from '../data/launches'
import { LaunchCard } from '../components/LaunchCard'

type Filter = 'all' | LaunchStatus

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Trending' },
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
    <main className="pb-24">
      {/* promo strip — value prop + stat ticker, marketplace-first */}
      <section className="rise-in mt-2 overflow-hidden rounded-3xl bg-surface ring-1 ring-line">
        <div className="grid gap-6 p-6 sm:grid-cols-[1.4fr_1fr] sm:items-center sm:p-8">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-tint px-2.5 py-1 text-[11px] font-semibold text-emerald-strong">
              Robinhood Chain
            </span>
            <h1 className="font-display mt-3 text-[30px] font-extrabold leading-[1.05] tracking-tight sm:text-[38px]">
              Launch a coin. Every trade pays the room.
            </h1>
            <p className="mt-2 max-w-md text-[13px] leading-relaxed text-ink-2">
              One flat price for the whole sale. No bonding curve, no early-buyer edge. After a coin
              graduates, its trade fee splits 50/50: half to holders, half rebated to the trader.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                onClick={onCreate}
                className="cursor-pointer rounded-full bg-emerald px-5 py-2.5 text-[14px] font-semibold text-paper transition hover:bg-emerald-strong"
              >
                Create a coin
              </button>
              <button
                onClick={() => setFilter('live')}
                className="cursor-pointer rounded-full px-4 py-2.5 text-[14px] font-medium text-ink-2 ring-1 ring-line transition hover:text-ink hover:ring-line-2"
              >
                See what's live
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 sm:grid-cols-1 sm:gap-0 sm:divide-y sm:divide-line">
            {[
              ['Paid out', `${compact(totalPaid)} RBH`],
              ['To holders', `${compact(toHolders)} RBH`],
              ['Live now', String(liveCount)],
            ].map(([k, v], i) => (
              <div key={k} className={`sm:flex sm:items-center sm:justify-between ${i > 0 ? 'sm:pt-3' : 'sm:pb-3'}`}>
                <p className="eyebrow order-1 sm:order-none">{k}</p>
                <p className="tnum mt-1 text-[19px] font-semibold text-ink sm:mt-0">{v}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* sort tabs */}
      <div className="mt-8 flex items-center gap-2 overflow-x-auto pb-1">
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
        <span className="tnum ml-auto hidden shrink-0 pl-3 text-[12px] text-ink-3 sm:block">{shown.length} coins</span>
      </div>

      {/* coin grid */}
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {shown.map((l, i) => (
          <LaunchCard key={l.id} launch={l} index={i} onOpen={() => onOpen(l.id)} />
        ))}
      </div>
    </main>
  )
}
