import { compact } from '../data/launches'

/**
 * The 50/50 as a metered readout: one 1px-framed bar cut dead center, blue
 * accent for the holders' half, monochrome slate for the trader's. Tick marks
 * at the quartiles so it reads like an instrument, not a chart.
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
          <p className="label text-emerald">HOLDERS · 50%</p>
          {!compactMode && <p className="mt-1 text-[11px] text-ink-3">shared out pro-rata</p>}
        </div>
        <div className="text-right">
          <p className="label" style={{ color: 'var(--color-gold)' }}>TRADER · 50%</p>
          {!compactMode && <p className="mt-1 text-[11px] text-ink-3">rebated to the swapper</p>}
        </div>
      </div>

      <div className="relative mt-2 flex h-8 w-full border border-line-2">
        <div className="flex w-1/2 items-center justify-start bg-emerald-tint pl-2.5">
          <span className="tnum text-[12px] font-medium text-emerald-strong">{compact(toHolders)} {unit}</span>
        </div>
        <div className="flex w-1/2 items-center justify-end bg-gold-tint pr-2.5">
          <span className="tnum text-[12px] font-medium text-ink-2">{compact(toTraders)} {unit}</span>
        </div>
        {/* center seam + quartile ticks */}
        <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line-2" />
        <div className="absolute top-0 left-1/4 h-1.5 w-px bg-line-2" />
        <div className="absolute bottom-0 left-3/4 h-1.5 w-px bg-line-2" />
      </div>

      {!compactMode && (
        <p className="mt-2 text-[10px] tracking-[0.1em] text-ink-3">
          &gt; SPLIT EXECUTED IN-BLOCK · NO TREASURY IN PATH
        </p>
      )}
    </div>
  )
}
