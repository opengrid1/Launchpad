import { compact } from '../data/launches'

/**
 * The 50/50, shown as one continuous baseline split at the midpoint — the
 * holders' half in Lincoln green, the trader's in cream. No borders; the
 * numbers sit above their halves like a caption to a diagram.
 */
export function SplitMeter({
  toHolders,
  toTraders,
  unit = 'RBH',
  compactMode = false,
}: {
  toHolders: number
  toTraders: number
  unit?: string
  compactMode?: boolean
}) {
  return (
    <div className="w-full">
      <div className="flex items-baseline justify-between">
        <div>
          <p className="tnum text-[17px] font-medium text-emerald-strong">{compact(toHolders)} <span className="text-[12px] text-ink-3">{unit}</span></p>
          <p className="mt-0.5 text-[12px] text-ink-2">to holders{!compactMode && ', pro-rata'}</p>
        </div>
        <div className="text-right">
          <p className="tnum text-[17px] font-medium text-ink">{compact(toTraders)} <span className="text-[12px] text-ink-3">{unit}</span></p>
          <p className="mt-0.5 text-[12px] text-ink-2">to the trader</p>
        </div>
      </div>

      <div className="relative mt-3 flex h-1.5 w-full">
        <div className="h-full w-1/2 bg-emerald" />
        <div className="h-full w-1/2 bg-ink/70" />
        <div className="absolute -top-1 left-1/2 h-3.5 w-px -translate-x-1/2 bg-paper" />
      </div>
      {!compactMode && (
        <p className="mt-3 text-[12px] italic text-ink-2">
          Split in the same block the trade settles. Nothing pauses in a treasury on the way.
        </p>
      )}
    </div>
  )
}
