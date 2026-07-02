/**
 * Coin mark. Shows the token image (URI) if set, else the emoji logo, else the
 * ticker initials — drawn in a rounded tile with a hairline ring.
 */
export function Monogram({
  symbol,
  glyph,
  image,
  size = 'md',
}: {
  symbol: string
  glyph?: string
  image?: string
  size?: 'md' | 'lg'
}) {
  const letters = symbol.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '··'
  const box = size === 'lg' ? 'h-12 w-12 rounded-xl' : 'h-10 w-10 rounded-lg'
  const emoji = size === 'lg' ? 'text-[26px]' : 'text-[20px]'

  if (image) {
    return <img src={image} alt={symbol} className={`${box} shrink-0 object-cover ring-1 ring-line-2`} />
  }
  return (
    <span className={`${box} flex shrink-0 items-center justify-center bg-panel ring-1 ring-line-2`}>
      {glyph ? (
        <span className={emoji}>{glyph}</span>
      ) : (
        <span className="font-display font-bold tracking-tight text-emerald-strong">{letters}</span>
      )}
    </span>
  )
}
