import type { Status } from '../data/offerings'

// A typographic label with a small solid square. Nothing blinks or pulses;
// "open" is a fact about the offering, not an attention-grabbing animation.
const MAP: Record<Status, { label: string; color: string }> = {
  open: { label: 'Open', color: 'var(--color-pos)' },
  scheduled: { label: 'Scheduled', color: 'var(--color-ink-2)' },
  funded: { label: 'Funded', color: 'var(--color-pos)' },
  refunding: { label: 'Refunding', color: 'var(--color-neg)' },
}

export function StatusTag({ status, size = 'sm' }: { status: Status; size?: 'sm' | 'xs' }) {
  const s = MAP[status]
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono font-medium uppercase tracking-[0.14em] ${size === 'xs' ? 'text-[10px]' : 'text-[11px]'}`}
      style={{ color: s.color }}
    >
      <span className="inline-block h-[7px] w-[7px] rounded-[1px]" style={{ background: s.color }} />
      {s.label}
    </span>
  )
}
