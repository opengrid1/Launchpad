import { useState } from 'react'
import { resolveUri } from '../lib/metadata'

const SIZES = {
  xs: 'h-8 w-8 rounded-lg text-sm',
  sm: 'h-10 w-10 rounded-xl text-base',
  md: 'h-12 w-12 rounded-full text-lg sm:h-10 sm:w-10 sm:rounded-xl sm:text-base',
  lg: 'h-16 w-16 rounded-2xl text-2xl',
} as const

const FALLBACK_BG = ['bg-brand-soft text-brand', 'bg-grad-purple-a text-[#7c5cd6]', 'bg-grad-blue-a text-[#2f7fd1]', 'bg-pos-soft text-pos']

/** Token avatar: remote image with a deterministic colored-monogram fallback. */
export function TokenImage({ src, symbol, size = 'sm' }: { src?: string; symbol: string; size?: keyof typeof SIZES }) {
  const [failed, setFailed] = useState(false)
  const cls = SIZES[size]

  if (src && !failed) {
    return (
      <img
        src={resolveUri(src)}
        alt={symbol}
        onError={() => setFailed(true)}
        className={`${cls} shrink-0 bg-card-2 object-cover ring-1 ring-line`}
        loading="lazy"
      />
    )
  }
  const tone = FALLBACK_BG[(symbol.charCodeAt(0) || 0) % FALLBACK_BG.length]
  return (
    <span className={`${cls} flex shrink-0 items-center justify-center font-bold ring-1 ring-line ${tone}`}>
      {symbol.slice(0, 1).toUpperCase() || '?'}
    </span>
  )
}
