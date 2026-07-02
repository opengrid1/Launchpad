import { compact } from '../data/launches'

/**
 * The 50/50, drawn as one bar cut exactly in half — emerald left (holders),
 * ink-hatched right (the trader). Clean and literal; the whole product in a line.
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
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-emerald">Holders · 50%</p>
          {!compactMode && <p className="mt-0.5 text-xs text-ink-3">shared out pro-rata</p>}
        </div>
        <div className="text-right">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-gold">The trader · 50%</p>
          {!compactMode && <p className="mt-0.5 text-xs text-ink-3">rebated to the swapper</p>}
        </div>
      </div>

      <div className="mt-2 flex h-9 w-full overflow-hidden rounded-lg border border-line">
        <div className="flex w-1/2 items-center justify-start bg-emerald-tint pl-3">
          <span className="tnum text-[13px] font-semibold text-emerald-strong">{compact(toHolders)} {unit}</span>
        </div>
        <div className="flex w-1/2 items-center justify-end border-l border-line-2 bg-gold-tint pr-3">
          <span className="tnum text-[13px] font-semibold text-gold">{compact(toTraders)} {unit}</span>
        </div>
      </div>

      {!compactMode && (
        <p className="mt-2 text-center text-[11px] text-ink-3">
          Split in the same transaction as the trade — no treasury in between.
        </p>
      )}
    </div>
  )
}
