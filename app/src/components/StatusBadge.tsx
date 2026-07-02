import type { LaunchStatus } from '../data/launches'

const STYLES: Record<LaunchStatus, { label: string; cls: string; dot?: boolean }> = {
  live: { label: 'LIVE', cls: 'text-emerald border-emerald/35', dot: true },
  upcoming: { label: 'QUEUED', cls: 'text-ink-2 border-line-2' },
  graduated: { label: 'GRAD', cls: 'text-ink-2 border-line-2' },
  refunding: { label: 'REFUND', cls: 'text-clay border-clay/35' },
}

export function StatusBadge({ status }: { status: LaunchStatus }) {
  const s = STYLES[status]
  return (
    <span className={`inline-flex items-center gap-1.5 border px-1.5 py-0.5 text-[10px] tracking-[0.14em] ${s.cls}`}>
      {s.dot && <span className="h-1 w-1 rounded-full bg-emerald live-dot" />}
      {s.label}
    </span>
  )
}
