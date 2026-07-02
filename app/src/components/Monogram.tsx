/**
 * Token mark: the ticker set large in the serif display face, no container.
 * It reads as a masthead initial, not a generated avatar.
 */
export function Monogram({ symbol, size = 'md' }: { symbol: string; size?: 'md' | 'lg' }) {
  const letters = symbol.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '··'
  const cls = size === 'lg' ? 'text-[34px]' : 'text-[26px]'
  return (
    <span className={`font-display ${cls} font-medium leading-none tracking-tight text-emerald-strong`}>
      {letters}
    </span>
  )
}
