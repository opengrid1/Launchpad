import { hardCapOf, type Launch } from '../data/launches'

/** Raise progress with a tick marking the soft cap. */
export function ProgressBar({ launch, tall = false }: { launch: Launch; tall?: boolean }) {
  const hardCap = hardCapOf(launch)
  const pct = Math.min(100, (launch.raised / hardCap) * 100)
  const softPct = (launch.softCap / hardCap) * 100
  const softMet = launch.raised >= launch.softCap
  const refunding = launch.status === 'refunding'

  return (
    <div className={`relative w-full overflow-hidden rounded-full bg-panel ${tall ? 'h-2' : 'h-1.5'}`}>
      <div
        className={`h-full rounded-full transition-all ${refunding ? 'bg-clay' : 'bg-emerald'}`}
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
