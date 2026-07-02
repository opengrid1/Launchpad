/**
 * Token mark — a hairline square with the ticker, drawn like a register cell.
 * No fill, no emoji: reads as an engineered index, not clip-art.
 */
export function Monogram({ symbol, size = 'md' }: { symbol: string; size?: 'md' | 'lg' }) {
  const letters = symbol.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '··'
  const dims = size === 'lg' ? 'h-12 w-12 text-[15px]' : 'h-10 w-10 text-[12px]'
  return (
    <span
      className={`flex ${dims} shrink-0 items-center justify-center border border-line-2 bg-paper font-mono font-medium tracking-tight text-ink`}
    >
      {letters}
    </span>
  )
}
