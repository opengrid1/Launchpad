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

/** Full-bleed square cover for board cards (flaunch-style image-forward grid). */
export function TokenCover({ src, symbol }: { src?: string; symbol: string }) {
  const [failed, setFailed] = useState(false)

  if (src && !failed) {
    return (
      <div className="aspect-square w-full overflow-hidden bg-ink-800">
        <img
          src={resolveUri(src)}
          alt={symbol}
          onError={() => setFailed(true)}
          className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
          loading="lazy"
        />
      </div>
    )
  }
  return (
    <div className="flex aspect-square w-full items-center justify-center bg-gradient-to-br from-ink-800 to-ink-850">
      <span className="font-display text-5xl font-bold text-mint-500/40">{symbol.slice(0, 4).toUpperCase() || '?'}</span>
    </div>
  )
}
