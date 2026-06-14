import { useState } from 'react'
import { resolveUri } from '../lib/metadata'

const SIZES = {
  xs: 'h-8 w-8 rounded-lg',
  sm: 'h-10 w-10 rounded-xl',
  md: 'h-12 w-12 rounded-xl sm:h-10 sm:w-10',
  lg: 'h-16 w-16 rounded-2xl',
} as const

const DEFAULT_IMG = '/token-default.png'

/** Token avatar: creator image with a shared default image fallback. */
export function TokenImage({ src, symbol, size = 'sm' }: { src?: string; symbol: string; size?: keyof typeof SIZES }) {
  const [failed, setFailed] = useState(false)
  const cls = SIZES[size]
  const url = src && !failed ? resolveUri(src) : DEFAULT_IMG

  return (
    <img
      src={url}
      alt={symbol}
      onError={() => setFailed(true)}
      className={`${cls} shrink-0 bg-panel2 object-cover shadow-sm ring-1 ring-hair`}
      loading="lazy"
    />
  )
}
