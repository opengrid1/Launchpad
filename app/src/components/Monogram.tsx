import { defaultTokenImage } from '../data/launches'

/**
 * Coin mark. Shows the token image (URI) if set, else the Loxley feather
 * default — drawn in a rounded tile with a hairline ring.
 */
export function Monogram({
  symbol,
  image,
  size = 'md',
}: {
  symbol: string
  glyph?: string
  image?: string
  size?: 'md' | 'lg'
}) {
  const box = size === 'lg' ? 'h-12 w-12 rounded-xl' : 'h-10 w-10 rounded-lg'
  return (
    <img
      src={image || defaultTokenImage()}
      alt={symbol}
      className={`${box} shrink-0 object-cover ring-1 ring-line-2`}
    />
  )
}
