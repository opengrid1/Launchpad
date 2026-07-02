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
      {/* hero */}
      <section className="rise-in mt-6 overflow-hidden rounded-3xl bg-pine-900 px-6 py-10 ring-1 ring-pine-700 sm:px-10">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-xl">
            <p className="font-mono text-xs uppercase tracking-[0.22em] text-moss-400">Every trade pays the room</p>
            <h1 className="mt-3 font-display text-4xl font-semibold leading-[1.04] tracking-tight sm:text-5xl">
              Half to the holders.
              <br />
              <span className="ink-underline">Half back to you.</span>
            </h1>
            <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-sage-300">
              Fixed-price token launches on Robinhood Chain. When a token graduates, every trade pays a
              small fee — and it splits straight down the middle: half redistributed to everyone holding,
              half rebated to the trader who made the swap.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <button
                onClick={onCreate}
                className="cursor-pointer rounded-xl bg-moss-500 px-5 py-2.5 text-sm font-semibold text-pine-950 transition hover:bg-moss-400"
              >
                Launch a token
              </button>
              <div className="flex items-center gap-5 rounded-xl bg-pine-850 px-4 py-2.5 font-mono text-xs text-sage-500 ring-1 ring-pine-700">
                <span>
                  <span className="font-semibold text-parch-100">{compact(totalPaid)}</span> RBH paid out
                </span>
                <span className="h-3 w-px bg-pine-600" />
                <span>
                  <span className="font-semibold text-parch-100">{liveCount}</span> live now
                </span>
              </div>
            </div>
          </div>

          {/* the split, drawn — a little hand-annotated diagram, not a stock hero image */}
          <div className="relative hidden w-[230px] shrink-0 sm:block">
            <span className="stamp absolute -top-3 -left-4 rounded-md border border-gold-400/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-gold-300">
              fair split
            </span>
            <svg viewBox="0 0 220 150" className="w-full" fill="none">
              <text x="110" y="16" textAnchor="middle" className="fill-sage-500 font-mono" fontSize="9">1 trade fee</text>
              <path className="drift" d="M110 22 L110 52" stroke="var(--color-parch-100)" strokeWidth="2.4" strokeLinecap="round" />
              <path d="M110 52 C110 74 46 74 34 100 M110 52 C110 74 174 74 186 100" stroke="var(--color-sage-500)" strokeWidth="1.8" strokeLinecap="round" />
              <circle cx="34" cy="110" r="18" fill="var(--color-moss-500)" fillOpacity="0.15" stroke="var(--color-moss-400)" strokeWidth="1.6" />
              <text x="34" y="114" textAnchor="middle" className="fill-moss-300 font-mono" fontSize="11" fontWeight="600">50%</text>
              <text x="34" y="140" textAnchor="middle" className="fill-sage-500 font-mono" fontSize="9">holders</text>
              <circle cx="186" cy="110" r="18" fill="var(--color-gold-400)" fillOpacity="0.15" stroke="var(--color-gold-400)" strokeWidth="1.6" />
              <text x="186" y="114" textAnchor="middle" className="fill-gold-300 font-mono" fontSize="11" fontWeight="600">50%</text>
              <text x="186" y="140" textAnchor="middle" className="fill-sage-500 font-mono" fontSize="9">you</text>
            </svg>
            <p className="mt-1 text-center font-mono text-[10px] text-sage-500">
              {compact(toHolders)} RBH → holders so far
            </p>
          </div>
        </div>
      </section>

      {/* filters */}
      <div className="mt-10 flex items-center gap-1.5 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`cursor-pointer whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] font-medium ring-1 transition ${
              filter === f.key
                ? 'bg-moss-500/15 text-moss-300 ring-moss-500/40'
                : 'bg-pine-850/60 text-sage-300 ring-pine-700 hover:text-parch-100'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((l, i) => (
          <LaunchCard key={l.id} launch={l} index={i} onOpen={() => onOpen(l.id)} />
        ))}
      </div>
    </main>
  )
}
