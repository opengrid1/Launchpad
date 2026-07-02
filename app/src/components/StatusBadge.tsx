import type { LaunchStatus } from '../data/launches'

const STYLES: Record<LaunchStatus, { label: string; cls: string; dot?: boolean }> = {
  live: { label: 'Live', cls: 'bg-emerald-tint text-emerald-strong', dot: true },
  upcoming: { label: 'Opens soon', cls: 'bg-gold-tint text-gold' },
  graduated: { label: 'Graduated', cls: 'bg-panel text-ink-2' },
  refunding: { label: 'Refunding', cls: 'bg-clay-tint text-clay' },
}

export function StatusBadge({ status }: { status: LaunchStatus }) {
  const s = STYLES[status]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] ${s.cls}`}>
      {s.dot && <span className="h-1.5 w-1.5 rounded-full bg-emerald live-dot" />}
      {s.label}
    </span>
  )
}
