import { compact, hardCapOf, price, rewardSplit, type Launch } from '../data/launches'
import { ProgressBar } from './ProgressBar'
import { StatusBadge } from './StatusBadge'

export function LaunchCard({ launch, onOpen, index }: { launch: Launch; onOpen: () => void; index: number }) {
  const hardCap = hardCapOf(launch)
  const pct = Math.min(100, (launch.raised / hardCap) * 100)
  const { toHolders } = rewardSplit(launch)
  const timeLabel = launch.startsIn
    ? `starts in ${launch.startsIn}`
    : launch.endsIn
      ? `ends in ${launch.endsIn}`
      : `ended ${launch.endedAgo}`

  return (
    <button
      onClick={onOpen}
      className="rise-in group cursor-pointer rounded-2xl bg-pine-850/80 p-5 text-left ring-1 ring-pine-700 backdrop-blur transition hover:-translate-y-0.5 hover:ring-moss-500/50"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-pine-700 text-xl ring-1 ring-pine-600">
            {launch.glyph}
          </span>
          <div>
            <h3 className="font-display text-[16px] font-semibold leading-tight group-hover:text-moss-300">
              {launch.name}
              <span className="ml-1.5 font-mono text-xs font-medium text-sage-500">${launch.symbol}</span>
            </h3>
            <p className="mt-0.5 line-clamp-1 text-[13px] text-sage-300">{launch.tagline}</p>
          </div>
        </div>
        <StatusBadge status={launch.status} />
      </div>

      <div className="mt-5 flex items-baseline justify-between font-mono text-xs text-sage-500">
        <span>
          <span className="text-sm font-semibold text-parch-100">{compact(launch.raised)}</span> / {compact(hardCap)} RBH
        </span>
        <span className={pct >= 100 ? 'text-moss-400' : ''}>{pct.toFixed(0)}%</span>
      </div>
      <div className="mt-2">
        <ProgressBar launch={launch} />
      </div>

      {/* the reward line — the reason to care about a Sherwood token */}
      <div className="mt-4 flex items-center justify-between rounded-xl bg-pine-800/70 px-3 py-2 ring-1 ring-pine-700">
        <span className="flex items-center gap-1.5 text-[12px] text-sage-300">
          <span className="text-moss-300">◐</span> {launch.tradeFeeBps / 100}% fee splits 50/50
        </span>
        <span className="font-mono text-[12px] text-gold-300">
          {launch.rewardsPaid > 0 ? `${compact(launch.rewardsPaid)} RBH paid` : 'no rewards yet'}
        </span>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-sage-500">
        <span className="font-mono">
          1 {launch.symbol} = <span className="text-sage-300">{price(launch.priceRbh)} RBH</span>
          <span className="ml-1.5 rounded bg-pine-700 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-moss-400">
            flat
          </span>
        </span>
        <span>{timeLabel}</span>
      </div>
      {toHolders > 0 && (
        <p className="sr-only">
          {compact(toHolders)} RBH shared to holders so far
        </p>
      )}
    </button>
  )
}
