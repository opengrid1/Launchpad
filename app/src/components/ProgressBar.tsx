import { hardCapOf, type Launch } from '../data/launches'

/** Raise progress with a tick marking the soft cap. */
export function ProgressBar({ launch, tall = false }: { launch: Launch; tall?: boolean }) {
  const hardCap = hardCapOf(launch)
  const pct = Math.min(100, (launch.raised / hardCap) * 100)
  const softPct = (launch.softCap / hardCap) * 100
  const softMet = launch.raised >= launch.softCap
  const refunding = launch.status === 'refunding'

  return (
    <div className={`relative w-full overflow-hidden rounded-full bg-pine-700 ${tall ? 'h-3' : 'h-2'}`}>
      <div
        className={`h-full rounded-full transition-all ${refunding ? 'bg-clay-400/70' : 'bg-gradient-to-r from-moss-600 to-moss-400'}`}
        style={{ width: `${pct}%` }}
      />
      <div
        title="soft cap"
        className={`absolute top-0 h-full w-0.5 ${softMet && !refunding ? 'bg-moss-300' : 'bg-sage-500'}`}
        style={{ left: `${softPct}%` }}
      />
    </div>
  )
}
