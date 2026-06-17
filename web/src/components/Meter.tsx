import { hardCapOf, type Offering } from '../data/offerings'

/**
 * Subscription against the hard cap, with a notch at the soft cap. The fill
 * color is meaningful: green once the soft cap is cleared (the offering will
 * settle), ink while still short of it, red when the offering failed. Width
 * is the only animated property and it reflects a real number.
 */
export function Meter({ offering, height = 6 }: { offering: Offering; height?: number }) {
  const hardCap = hardCapOf(offering)
  const pct = Math.min(100, (offering.raised / hardCap) * 100)
  const softPct = Math.min(100, (offering.softCap / hardCap) * 100)
  const softMet = offering.raised >= offering.softCap
  const failed = offering.status === 'refunding'
  const fill = failed ? 'var(--color-neg)' : softMet ? 'var(--color-pos)' : 'var(--color-ink)'

  return (
    <div className="relative w-full rounded-full bg-paper-2 ring-1 ring-rule" style={{ height }}>
      <div className="meter-fill h-full rounded-full" style={{ width: `${pct}%`, background: fill }} />
      <div
        className="absolute -top-[2px] -bottom-[2px] w-[1.5px]"
        style={{ left: `calc(${softPct}% - 0.75px)`, background: softMet ? 'var(--color-pos)' : 'var(--color-ink-2)' }}
        title={`soft cap ${offering.softCap} ETH`}
      />
    </div>
  )
}
