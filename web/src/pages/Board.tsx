import { useState } from 'react'
import { OFFERINGS, hardCapOf, eth, par, timeLabel, type Offering, type Status } from '../data/offerings'
import { Mark } from '../components/Mark'
import { Meter } from '../components/Meter'
import { StatusTag } from '../components/StatusTag'
import { ParLine } from '../components/ParLine'

type Filter = 'all' | Status
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'funded', label: 'Funded' },
  { key: 'refunding', label: 'Refunding' },
]

const COLS = 'lg:grid-cols-[1fr_136px_220px_120px_104px]'

function Row({ o, onOpen }: { o: Offering; onOpen: () => void }) {
  const hardCap = hardCapOf(o)
  const pct = Math.min(100, (o.raised / hardCap) * 100)
  return (
    <button
      onClick={onOpen}
      className={`grid w-full grid-cols-1 ${COLS} items-start gap-x-4 gap-y-3 border-b border-rule px-2 py-4 text-left transition hover:bg-surface lg:items-center`}
    >
      {/* identity */}
      <div className="flex min-w-0 items-center gap-3">
        <Mark ticker={o.ticker} size={38} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-serif text-[16px] font-semibold leading-tight">{o.name}</span>
            <span className="font-mono text-[11px] text-ink-3">{o.ticker}</span>
            <span className="lg:hidden">
              <StatusTag status={o.status} size="xs" />
            </span>
          </div>
          <p className="mt-0.5 line-clamp-1 text-[13px] leading-snug text-ink-2">{o.purpose}</p>
        </div>
      </div>

      {/* par price */}
      <div className="hidden text-right lg:block">
        <span className="tnum font-mono text-[13px] text-ink">{par(o.priceEth)}</span>
        <span className="ml-1 font-mono text-[11px] text-ink-3">ETH</span>
      </div>

      {/* subscription */}
      <div className="min-w-0">
        <Meter offering={o} />
        <div className="mt-1.5 flex items-baseline justify-between font-mono text-[11px] text-ink-2">
          <span className="tnum">
            {eth(o.raised)} <span className="text-ink-3">/ {eth(hardCap)} ETH</span>
          </span>
          <span className="tnum text-ink">{pct.toFixed(0)}%</span>
        </div>
      </div>

      {/* closes */}
      <div className="hidden text-right font-mono text-[12px] text-ink-2 lg:block">{timeLabel(o)}</div>

      {/* status */}
      <div className="hidden justify-end lg:flex">
        <StatusTag status={o.status} />
      </div>

      {/* mobile meta line */}
      <div className="flex items-baseline justify-between font-mono text-[11px] text-ink-2 lg:hidden">
        <span className="tnum">
          {par(o.priceEth)} ETH <span className="text-ink-3">· par</span>
        </span>
        <span>{timeLabel(o)}</span>
      </div>
    </button>
  )
}

export function Board({ onOpen, onIssue }: { onOpen: (id: number) => void; onIssue: () => void }) {
  const [filter, setFilter] = useState<Filter>('all')
  const shown = OFFERINGS.filter((o) => filter === 'all' || o.status === filter)
  const open = OFFERINGS.filter((o) => o.status === 'open')
  const subscribed = OFFERINGS.reduce((s, o) => s + o.raised, 0)
  const count = (k: Filter) => (k === 'all' ? OFFERINGS.length : OFFERINGS.filter((o) => o.status === k).length)

  return (
    <main>
      {/* thesis band — states what makes this different, no marketing hero */}
      <section className="flex flex-col gap-6 border-b border-rule py-8 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-xl">
          <h1 className="font-serif text-[28px] font-medium leading-[1.15] tracking-[-0.01em] sm:text-[34px]">
            Every subscriber pays the same price.
          </h1>
          <p className="mt-3 max-w-md text-[15px] leading-relaxed text-ink-2">
            Par runs fixed-price token offerings on Ethereum. No bonding curve, so the first wallet in
            and the last wallet in buy at one rate. Clear the soft cap and liquidity is paired on Uniswap
            with the LP burned. Miss it and everyone is refunded in full.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[12px] text-ink-2">
            <span>
              <span className="tnum text-ink">{open.length}</span> open
            </span>
            <span>
              <span className="tnum text-ink">{eth(subscribed)}</span> ETH subscribed
            </span>
            <button onClick={onIssue} className="cursor-pointer text-accent underline-offset-4 hover:underline">
              Issue an offering →
            </button>
          </div>
        </div>
        <div className="shrink-0 self-start sm:self-center">
          <ParLine width={156} height={64} />
          <div className="mt-1.5 flex justify-between font-mono text-[10px] uppercase tracking-[0.12em]">
            <span className="text-accent">par price</span>
            <span className="text-ink-3">curve</span>
          </div>
        </div>
      </section>

      {/* filters */}
      <div className="mt-7 flex items-center gap-5 overflow-x-auto border-b border-rule pb-3">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`flex cursor-pointer items-center gap-1.5 whitespace-nowrap font-mono text-[12px] uppercase tracking-[0.1em] transition ${
              filter === f.key ? 'text-ink' : 'text-ink-3 hover:text-ink-2'
            }`}
          >
            {f.label}
            <span className={`tnum text-[11px] ${filter === f.key ? 'text-accent' : 'text-ink-3'}`}>{count(f.key)}</span>
          </button>
        ))}
      </div>

      {/* column header (desktop) */}
      <div className={`hidden ${COLS} mt-2 grid items-center gap-x-4 px-2 pb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3 lg:grid`}>
        <span>Offering</span>
        <span className="text-right">Par price</span>
        <span>Subscription</span>
        <span className="text-right">Closes</span>
        <span className="text-right">Status</span>
      </div>

      <div className="border-t border-rule lg:border-t-0">
        {shown.map((o) => (
          <Row key={o.id} o={o} onOpen={() => onOpen(o.id)} />
        ))}
        {shown.length === 0 && (
          <p className="px-2 py-12 text-center font-mono text-[13px] text-ink-3">No offerings in this state.</p>
        )}
      </div>
    </main>
  )
}
