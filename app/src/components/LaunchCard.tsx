import { compact, hardCapOf, price, type Launch } from '../data/launches'
import { ProgressBar } from './ProgressBar'
import { StatusBadge } from './StatusBadge'
import { Monogram } from './Monogram'

export function LaunchCard({ launch, onOpen, index }: { launch: Launch; onOpen: () => void; index: number }) {
  const hardCap = hardCapOf(launch)
  const pct = Math.min(100, (launch.raised / hardCap) * 100)
  const timeLabel = launch.startsIn
    ? `T-${launch.startsIn}`
    : launch.endsIn
      ? `${launch.endsIn} left`
      : launch.endedAgo

  return (
    <button
      onClick={onOpen}
      className="rise-in group flex cursor-pointer flex-col border border-line bg-surface p-4 text-left transition-colors hover:border-line-2"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Monogram symbol={launch.symbol} />
          <div>
            <h3 className="text-[14px] font-medium leading-tight tracking-tight text-ink group-hover:text-emerald-strong">
              {launch.name}
            </h3>
            <p className="tnum mt-0.5 text-[11px] text-ink-3">{launch.symbol}</p>
          </div>
        </div>
        <StatusBadge status={launch.status} />
      </div>

      <p className="mt-3 line-clamp-1 text-[12px] leading-snug text-ink-2">{launch.tagline}</p>

      <div className="mt-4 flex items-baseline justify-between">
        <span className="tnum text-[12px] text-ink-3">
          <span className="text-[13px] font-medium text-ink">{compact(launch.raised)}</span> / {compact(hardCap)}
        </span>
        <span className={`tnum text-[12px] ${pct >= 100 ? 'text-emerald' : 'text-ink-2'}`}>{pct.toFixed(0)}%</span>
      </div>
      <div className="mt-2">
        <ProgressBar launch={launch} />
      </div>

      {/* data rows — register style, hairline separated */}
      <dl className="mt-4 space-y-1.5 border-t border-line pt-3 text-[11px]">
        <div className="flex justify-between">
          <dt className="label">FEE / SPLIT</dt>
          <dd className="tnum text-ink-2">{launch.tradeFeeBps / 100}% · 50/50</dd>
        </div>
        <div className="flex justify-between">
          <dt className="label">PAID OUT</dt>
          <dd className="tnum text-ink-2">{launch.rewardsPaid > 0 ? `${compact(launch.rewardsPaid)} RBH` : '—'}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="label">PRICE</dt>
          <dd className="tnum text-ink-2">{price(launch.priceRbh)} · flat</dd>
        </div>
      </dl>

      <p className="tnum mt-3 text-[10px] tracking-[0.1em] text-ink-3">{timeLabel}</p>
    </button>
  )
}
