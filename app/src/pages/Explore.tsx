import { useState } from 'react'
import { LAUNCHES, compact, hardCapOf, rewardSplit, type LaunchStatus } from '../data/launches'
import { LaunchCard } from '../components/LaunchCard'
import { ProgressBar } from '../components/ProgressBar'
import { StatusBadge } from '../components/StatusBadge'
import { Monogram } from '../components/Monogram'

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

  const featured = LAUNCHES.find((l) => l.status === 'live') ?? LAUNCHES[0]
  const fHardCap = hardCapOf(featured)
  const fPct = Math.min(100, (featured.raised / fHardCap) * 100)
  const fSplit = rewardSplit(featured)

  return (
    <main>
      {/* hero: copy on the left, a live launch on the right, balanced */}
      <section className="rise-in grid items-center gap-12 py-12 sm:py-16 lg:grid-cols-[1.05fr_0.95fr]">
        <div>
          <p className="eyebrow">Launchpad on Robinhood Chain</p>
          <h1 className="font-display mt-5 text-[44px] font-normal leading-[1.03] tracking-tight sm:text-[60px]">
            Half to the holders.
            <br />
            Half back to <span className="italic text-emerald-strong">you</span>.
          </h1>
          <p className="mt-6 max-w-md text-[16px] leading-relaxed text-ink-2">
            Every token launches at one flat price. No bonding curve, no early-buyer edge. Once a sale
            graduates, each trade pays a small fee that splits in half. Holders keep one half. The trader who
            made the swap keeps the other.
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
              Browse live sales
            </button>
          </div>
        </div>

        {/* featured live launch */}
        <button
          onClick={() => onOpen(featured.id)}
          className="group cursor-pointer rounded-2xl bg-surface p-6 text-left ring-1 ring-line transition hover:ring-line-2 sm:p-7"
        >
          <div className="flex items-center justify-between">
            <StatusBadge status={featured.status} />
            <span className="tnum text-[12px] text-ink-3">
              {featured.endsIn ? `${featured.endsIn} left` : featured.startsIn ? `opens in ${featured.startsIn}` : featured.endedAgo}
            </span>
          </div>

          <div className="mt-5 flex items-center gap-4">
            <Monogram symbol={featured.symbol} size="lg" />
            <div>
              <h2 className="font-display text-[26px] font-medium leading-none tracking-tight text-ink group-hover:text-emerald-strong">
                {featured.name}
              </h2>
              <p className="tnum mt-1.5 text-[12px] text-ink-3">{featured.symbol}</p>
            </div>
          </div>
          <p className="mt-4 text-[14px] leading-relaxed text-ink-2">{featured.tagline}</p>

          <div className="mt-6">
            <div className="flex items-baseline justify-between">
              <span className="tnum text-[14px] text-ink-2">
                <span className="text-ink">{compact(featured.raised)}</span> of {compact(fHardCap)} RBH
              </span>
              <span className="tnum text-[13px] text-ink-3">{fPct.toFixed(0)}%</span>
            </div>
            <div className="mt-2.5">
              <ProgressBar launch={featured} tall />
            </div>
          </div>

          <div className="mt-6 flex items-baseline justify-between border-t border-line pt-5">
            <div>
              <p className="tnum text-[15px] font-medium text-emerald-strong">{compact(fSplit.toHolders)} RBH</p>
              <p className="mt-0.5 text-[12px] text-ink-3">paid to holders</p>
            </div>
            <div className="text-right">
              <p className="tnum text-[15px] font-medium text-ink">{compact(fSplit.toTraders)} RBH</p>
              <p className="mt-0.5 text-[12px] text-ink-3">rebated to traders</p>
            </div>
          </div>
        </button>
      </section>

      {/* three figures, divided by hairlines */}
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

        <div className="mt-4 grid gap-x-10 gap-y-1 divide-y divide-line pb-24 sm:grid-cols-2 sm:divide-y-0">
          {shown.map((l, i) => (
            <LaunchCard key={l.id} launch={l} index={i} onOpen={() => onOpen(l.id)} />
          ))}
        </div>
      </section>
    </main>
  )
}
