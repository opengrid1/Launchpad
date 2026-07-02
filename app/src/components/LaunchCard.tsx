import { compact, hardCapOf, price, type Launch } from '../data/launches'
import { ProgressBar } from './ProgressBar'
import { StatusBadge } from './StatusBadge'
import { Monogram } from './Monogram'

export function LaunchCard({ launch, onOpen, index }: { launch: Launch; onOpen: () => void; index: number }) {
  const hardCap = hardCapOf(launch)
  const pct = Math.min(100, (launch.raised / hardCap) * 100)
  const timeLabel = launch.startsIn
    ? `Starts in ${launch.startsIn}`
    : launch.endsIn
      ? `Ends in ${launch.endsIn}`
      : `Ended ${launch.endedAgo}`

  return (
    <button
      onClick={onOpen}
      className="rise-in group flex cursor-pointer flex-col rounded-2xl border border-line bg-surface p-5 text-left transition hover:border-line-2"
      style={{ animationDelay: `${index * 55}ms` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Monogram symbol={launch.symbol} />
          <div>
            <h3 className="font-display text-[16px] font-semibold leading-tight tracking-tight">
              {launch.name}
              <span className="ml-1.5 text-[13px] font-normal text-ink-3">{launch.symbol}</span>
            </h3>
            <p className="mt-0.5 line-clamp-1 text-[13px] leading-snug text-ink-2">{launch.tagline}</p>
          </div>
        </div>
        <StatusBadge status={launch.status} />
      </div>

      <div className="mt-6 flex items-baseline justify-between">
        <span className="tnum text-[13px] text-ink-2">
          <span className="text-[15px] font-semibold text-ink">{compact(launch.raised)}</span>
          <span className="text-ink-3"> / {compact(hardCap)} RBH</span>
        </span>
        <span className={`tnum text-[13px] font-medium ${pct >= 100 ? 'text-emerald' : 'text-ink-3'}`}>{pct.toFixed(0)}%</span>
      </div>
      <div className="mt-2">
        <ProgressBar launch={launch} />
      </div>

      <div className="mt-5 flex items-center justify-between border-t border-line pt-4 text-[13px]">
        <span className="text-ink-2">
          {launch.tradeFeeBps / 100}% fee, <span className="font-medium text-ink">split 50/50</span>
        </span>
        <span className="tnum text-ink-3">
          {launch.rewardsPaid > 0 ? `${compact(launch.rewardsPaid)} paid out` : 'pre-graduation'}
        </span>
      </div>

      <div className="mt-3 flex items-center justify-between text-[12px] text-ink-3">
        <span className="tnum">1 {launch.symbol} = {price(launch.priceRbh)} RBH · flat</span>
        <span>{timeLabel}</span>
      </div>
    </button>
  )
}
