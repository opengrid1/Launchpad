import type { LaunchStatus } from '../data/launches'

const STYLES: Record<LaunchStatus, { label: string; cls: string; dot?: boolean }> = {
  live: { label: 'Live', cls: 'bg-moss-500/15 text-moss-300 ring-moss-500/40', dot: true },
  upcoming: { label: 'Opens soon', cls: 'bg-gold-400/10 text-gold-300 ring-gold-400/30' },
  graduated: { label: 'Graduated', cls: 'bg-moss-500/10 text-moss-400 ring-moss-500/25' },
  refunding: { label: 'Refunding', cls: 'bg-clay-400/10 text-clay-400 ring-clay-400/30' },
}

export function StatusBadge({ status }: { status: LaunchStatus }) {
  const s = STYLES[status]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ring-1 ${s.cls}`}>
      {s.dot && <span className="h-1.5 w-1.5 rounded-full bg-moss-400 live-dot" />}
      {s.label}
    </span>
  )
}
