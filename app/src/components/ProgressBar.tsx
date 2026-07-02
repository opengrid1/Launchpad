import { hardCapOf, type Launch } from '../data/launches'

/** Raise progress: a 1px-framed track, hard fill, soft-cap tick. No rounding. */
export function ProgressBar({ launch, tall = false }: { launch: Launch; tall?: boolean }) {
  const hardCap = hardCapOf(launch)
  const pct = Math.min(100, (launch.raised / hardCap) * 100)
  const softPct = (launch.softCap / hardCap) * 100
  const softMet = launch.raised >= launch.softCap
  const refunding = launch.status === 'refunding'

  return (
    <div className={`relative w-full overflow-hidden border border-line bg-paper ${tall ? 'h-2.5' : 'h-2'}`}>
      <div
        className={`h-full transition-all duration-200 ${refunding ? 'bg-clay/70' : 'bg-emerald'}`}
        style={{ width: `${pct}%` }}
      />
      <div
        title="soft cap"
        className={`absolute top-0 h-full w-px ${softMet && !refunding ? 'bg-emerald-strong' : 'bg-line-2'}`}
        style={{ left: `${softPct}%` }}
      />
    </div>
  )
}
