import { useState } from 'react'
import { resolveUri } from '../lib/metadata'

const SIZES = {
  sm: 'h-11 w-11 rounded-xl text-lg',
  lg: 'h-16 w-16 rounded-2xl text-2xl',
} as const

/** Token avatar: remote image with a deterministic monogram fallback. */
export function TokenImage({ src, symbol, size = 'sm' }: { src?: string; symbol: string; size?: keyof typeof SIZES }) {
  const [failed, setFailed] = useState(false)
  const cls = SIZES[size]

  if (src && !failed) {
    return (
      <img
        src={resolveUri(src)}
        alt={symbol}
        onError={() => setFailed(true)}
        className={`${cls} shrink-0 bg-ink-700 object-cover ring-1 ring-ink-600`}
        loading="lazy"
      />
    )
  }
  return (
    <span className={`${cls} flex shrink-0 items-center justify-center bg-ink-700 font-bold text-mint-400 ring-1 ring-ink-600`}>
      {symbol.slice(0, 1).toUpperCase() || '?'}
    </span>
  )
}
