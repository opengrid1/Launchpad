import { eth } from '../data/launches'

/**
 * The 50/50 ETH tax split: holders' half in Lincoln green, the creator's half
 * in cream, cut dead centre. Numbers caption their own halves.
 */
export function SplitMeter({
  toHolders,
  toCreator,
  unit = 'ETH',
  compactMode = false,
}: {
  toHolders: number
  toCreator: number
  unit?: string
  compactMode?: boolean
}) {
  return (
    <div className="w-full">
      <div className="flex items-baseline justify-between">
        <div>
          <p className="tnum text-[17px] font-semibold text-emerald-strong">{eth(toHolders)} <span className="text-[12px] text-ink-3">{unit}</span></p>
          <p className="mt-0.5 text-[12px] text-ink-2">to holders{!compactMode && ', pro-rata'}</p>
        </div>
        <div className="text-right">
          <p className="tnum text-[17px] font-semibold text-ink">{eth(toCreator)} <span className="text-[12px] text-ink-3">{unit}</span></p>
          <p className="mt-0.5 text-[12px] text-ink-2">to the creator</p>
        </div>
      </div>

      <div className="relative mt-3 flex h-2 w-full overflow-hidden rounded-full">
        <div className="h-full w-1/2 bg-emerald" />
        <div className="h-full w-1/2 bg-ink/70" />
        <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-paper" />
      </div>
      {!compactMode && (
        <p className="mt-3 text-[12px] leading-relaxed text-ink-2">
          Split in the same block the trade settles. Half to everyone holding, half to whoever created the coin.
        </p>
      )}
    </div>
  )
}
