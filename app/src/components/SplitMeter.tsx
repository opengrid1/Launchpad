import { compact } from '../data/launches'

/**
 * The 50/50 diagram — Sherwood's whole identity in one drawing.
 * Every trade fee forks down the middle: half fans out to holders, half
 * doubles back to the trader. Drawn as a fee coming in from the top and
 * splitting into two payout chutes, hand-inked rather than a plain bar.
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
      {!compactMode && (
        <div className="flex justify-center">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-sage-500">the fee comes in here</span>
        </div>
      )}

      {/* the fork — an inked Y that splits one stream into two */}
      <svg viewBox="0 0 200 54" className="mx-auto mt-1 block w-full max-w-[280px]" fill="none">
        <path d="M100 2 L100 20" stroke="var(--color-parch-100)" strokeWidth="2.4" strokeLinecap="round" />
        <path
          d="M100 20 C100 30 74 30 60 40 M100 20 C100 30 126 30 140 40"
          stroke="var(--color-sage-500)"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        {/* left arrowhead → holders */}
        <path d="M64 34 L60 41 L67 43" stroke="var(--color-moss-400)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {/* right arrowhead → you */}
        <path d="M136 34 L140 41 L133 43" stroke="var(--color-gold-400)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <text x="100" y="15" textAnchor="middle" className="fill-sage-500 font-mono" fontSize="8">50 / 50</text>
      </svg>

      <div className="mt-1 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-moss-500/10 px-3.5 py-3 ring-1 ring-moss-500/25">
          <p className="text-[11px] font-medium uppercase tracking-wide text-moss-300">50% · holders</p>
          <p className="mt-1 font-mono text-sm font-semibold text-parch-100">
            {compact(toHolders)} <span className="text-xs text-sage-500">{unit}</span>
          </p>
          {!compactMode && <p className="mt-0.5 text-[11px] leading-snug text-sage-500">shared out to everyone holding, pro-rata</p>}
        </div>
        <div className="rounded-xl bg-gold-400/10 px-3.5 py-3 ring-1 ring-gold-400/25">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gold-300">50% · the trader</p>
          <p className="mt-1 font-mono text-sm font-semibold text-parch-100">
            {compact(toTraders)} <span className="text-xs text-sage-500">{unit}</span>
          </p>
          {!compactMode && <p className="mt-0.5 text-[11px] leading-snug text-sage-500">rebated back to whoever made the trade</p>}
        </div>
      </div>
    </div>
  )
}
