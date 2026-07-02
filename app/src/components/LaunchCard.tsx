import { compact, hardCapOf, price, type Launch } from '../data/launches'
import { ProgressBar } from './ProgressBar'
import { StatusBadge } from './StatusBadge'
import { Monogram } from './Monogram'

export function LaunchCard({ launch, onOpen, index }: { launch: Launch; onOpen: () => void; index: number }) {
  const hardCap = hardCapOf(launch)
  const pct = Math.min(100, (launch.raised / hardCap) * 100)
  const timeLabel = launch.startsIn
    ? `opens in ${launch.startsIn}`
    : launch.endsIn
      ? `${launch.endsIn} left`
      : (launch.endedAgo ?? '')

  return (
    <button
      onClick={onOpen}
      className="rise-in group -mx-3 flex cursor-pointer flex-col rounded-lg px-3 py-5 text-left transition-colors hover:bg-surface"
      style={{ animationDelay: `${index * 45}ms` }}
    >
      <div className="flex items-start gap-4">
        <Monogram symbol={launch.symbol} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="font-display text-[19px] font-medium leading-tight tracking-tight text-ink transition-colors group-hover:text-emerald-strong">
              {launch.name}
            </h3>
            <StatusBadge status={launch.status} />
          </div>
          <p className="mt-1 line-clamp-1 text-[13px] leading-snug text-ink-2">{launch.tagline}</p>
        </div>
      </div>

      <div className="mt-5 flex items-baseline justify-between">
        <span className="tnum text-[13px] text-ink-2">
          <span className="text-ink">{compact(launch.raised)}</span> of {compact(hardCap)} RBH
        </span>
        <span className={`tnum text-[13px] ${pct >= 100 ? 'text-emerald-strong' : 'text-ink-3'}`}>{pct.toFixed(0)}%</span>
      </div>
      <div className="mt-2.5">
        <ProgressBar launch={launch} />
      </div>

      <div className="mt-4 flex items-baseline justify-between text-[12px] text-ink-3">
        <span className="tnum">
          {price(launch.priceRbh)} RBH · {launch.tradeFeeBps / 100}% fee, split
        </span>
        <span>{timeLabel}</span>
      </div>
    </button>
  )
}
