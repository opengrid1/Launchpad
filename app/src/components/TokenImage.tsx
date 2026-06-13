import { useState } from 'react'
import { resolveUri } from '../lib/metadata'

const SIZES = {
  xs: 'h-8 w-8 rounded-lg text-sm',
  sm: 'h-10 w-10 rounded-xl text-base',
  md: 'h-12 w-12 rounded-xl text-lg sm:h-10 sm:w-10 sm:text-base',
  lg: 'h-16 w-16 rounded-2xl text-2xl',
} as const

/** Token avatar: remote image with a monogram fallback. */
export function TokenImage({ src, symbol, size = 'sm' }: { src?: string; symbol: string; size?: keyof typeof SIZES }) {
  const [failed, setFailed] = useState(false)
  const cls = SIZES[size]

  if (src && !failed) {
    return (
      <img
        src={resolveUri(src)}
        alt={symbol}
        onError={() => setFailed(true)}
        className={`${cls} shrink-0 bg-panel2 object-cover shadow-sm ring-1 ring-hair`}
        loading="lazy"
      />
    )
  }
  return (
    <span
      className={`${cls} flex shrink-0 items-center justify-center bg-gradient-to-br from-panel2 to-base font-bold text-acc shadow-sm ring-1 ring-hair`}
    >
      {symbol.slice(0, 1).toUpperCase() || '?'}
    </span>
  )
}
