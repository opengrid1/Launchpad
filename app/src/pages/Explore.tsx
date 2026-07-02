import { useState } from 'react'
import { LAUNCHES, compact, rewardSplit, type LaunchStatus } from '../data/launches'
import { LaunchCard } from '../components/LaunchCard'

type Filter = 'all' | LaunchStatus

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'ALL' },
  { key: 'live', label: 'LIVE' },
  { key: 'upcoming', label: 'QUEUED' },
  { key: 'graduated', label: 'GRAD' },
  { key: 'refunding', label: 'REFUND' },
]

export function Explore({ onOpen, onCreate }: { onOpen: (id: number) => void; onCreate: () => void }) {
  const [filter, setFilter] = useState<Filter>('all')
  const shown = LAUNCHES.filter((l) => filter === 'all' || l.status === filter)
  const totalPaid = LAUNCHES.reduce((s, l) => s + l.rewardsPaid, 0)
  const toHolders = LAUNCHES.reduce((s, l) => s + rewardSplit(l).toHolders, 0)
  const liveCount = LAUNCHES.filter((l) => l.status === 'live').length

  return (
    <main>
      {/* hero — restrained, left-weighted, terminal */}
      <section className="rise-in grid gap-10 border-b border-line py-12 lg:grid-cols-[1.15fr_0.85fr] lg:py-16">
        <div className="max-w-xl">
          <p className="label text-emerald">// FEE REDISTRIBUTION PROTOCOL</p>
          <h1 className="font-display mt-4 text-[38px] font-semibold leading-[1.02] tracking-tight sm:text-[46px]">
            Half to the holders.
            <br />
            Half back to you.<span className="blink text-emerald">_</span>
          </h1>
          <p className="mt-5 max-w-md text-[13px] leading-relaxed text-ink-2">
            Fixed-price token launches on Robinhood Chain. On graduation, every trade pays a fee that is
            split in-block — half to holders pro-rata, half rebated to the trader. No treasury, no curve.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-2.5">
            <button
              onClick={onCreate}
              className="cursor-pointer border border-emerald/40 bg-emerald-tint px-4 py-2 text-[13px] text-emerald-strong transition-colors hover:border-emerald/70"
            >
              [ deploy a launch ]
            </button>
            <button
              onClick={() => setFilter('live')}
              className="cursor-pointer border border-line-2 px-4 py-2 text-[13px] text-ink-2 transition-colors hover:text-ink"
            >
              browse live
            </button>
          </div>
        </div>

        {/* stats readout — a register block, not a card grid */}
        <div className="self-center border border-line">
          <div className="border-b border-line px-4 py-2">
            <span className="label">// NETWORK READOUT</span>
          </div>
          {[
            ['PAID OUT / TOTAL', `${compact(totalPaid)} RBH`],
            ['→ TO HOLDERS', `${compact(toHolders)} RBH`],
            ['LIVE SALES', String(liveCount).padStart(2, '0')],
            ['SPLIT RATIO', '50 / 50'],
          ].map(([k, v], i) => (
            <div key={k} className={`flex items-baseline justify-between px-4 py-3 ${i < 3 ? 'border-b border-line' : ''}`}>
              <span className="label">{k}</span>
              <span className="tnum text-[15px] font-medium text-ink">{v}</span>
            </div>
          ))}
        </div>
      </section>

      {/* filters */}
      <div className="flex items-center justify-between py-4">
        <div className="flex items-center gap-4 overflow-x-auto">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`cursor-pointer whitespace-nowrap text-[11px] tracking-[0.12em] transition-colors ${
                filter === f.key ? 'text-emerald' : 'text-ink-3 hover:text-ink-2'
              }`}
            >
              {filter === f.key ? '● ' : '○ '}
              {f.label}
            </button>
          ))}
        </div>
        <span className="label hidden sm:block">{String(shown.length).padStart(2, '0')} MARKETS</span>
      </div>

      <div className="grid gap-3 pb-24 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((l, i) => (
          <LaunchCard key={l.id} launch={l} index={i} onOpen={() => onOpen(l.id)} />
        ))}
      </div>
    </main>
  )
}
