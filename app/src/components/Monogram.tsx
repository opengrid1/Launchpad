/**
 * A token mark, built from its symbol — a small typographic tile instead of
 * an emoji. Keeps the whole surface feeling authored rather than clip-art.
 */
export function Monogram({ symbol, size = 'md' }: { symbol: string; size?: 'md' | 'lg' }) {
  const letters = symbol.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '·'
  const dims = size === 'lg' ? 'h-14 w-14 text-lg' : 'h-11 w-11 text-[13px]'
  return (
    <span
      className={`flex ${dims} shrink-0 items-center justify-center rounded-xl border border-line bg-panel font-display font-semibold tracking-tight text-ink`}
    >
      {letters}
    </span>
  )
}
