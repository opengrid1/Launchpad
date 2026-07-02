import type { LaunchStatus } from '../data/launches'

const STYLES: Record<LaunchStatus, { label: string; cls: string; dot?: boolean }> = {
  live: { label: 'Live now', cls: 'text-emerald-strong', dot: true },
  upcoming: { label: 'Opens soon', cls: 'text-gold' },
  graduated: { label: 'Graduated', cls: 'text-ink-2' },
  refunding: { label: 'Refunding', cls: 'text-clay' },
}

/** No pill, no box — just a marked word. */
export function StatusBadge({ status }: { status: LaunchStatus }) {
  const s = STYLES[status]
  return (
    <span className={`inline-flex items-center gap-1.5 text-[12px] font-medium ${s.cls}`}>
      {s.dot && <span className="h-1.5 w-1.5 rounded-full bg-emerald live-dot" />}
      {s.label}
    </span>
  )
}
