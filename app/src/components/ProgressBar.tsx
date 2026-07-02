import { hardCapOf, type Launch } from '../data/launches'

/** A thin baseline fill with a soft-cap notch. No frame, no rounding fuss. */
export function ProgressBar({ launch, tall = false }: { launch: Launch; tall?: boolean }) {
  const hardCap = hardCapOf(launch)
  const pct = Math.min(100, (launch.raised / hardCap) * 100)
  const softPct = (launch.softCap / hardCap) * 100
  const softMet = launch.raised >= launch.softCap
  const refunding = launch.status === 'refunding'

  return (
    <div className={`relative w-full ${tall ? 'h-1.5' : 'h-1'} bg-line-2`}>
      <div
        className={`h-full transition-all duration-500 ${refunding ? 'bg-clay' : 'bg-emerald'}`}
        style={{ width: `${pct}%` }}
      />
      <div
        title="soft cap"
        className={`absolute -top-1 h-[calc(100%+0.5rem)] w-px ${softMet && !refunding ? 'bg-emerald-strong' : 'bg-ink-3'}`}
        style={{ left: `${softPct}%` }}
      />
    </div>
  )
}
