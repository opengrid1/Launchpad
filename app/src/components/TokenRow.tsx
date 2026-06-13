import { useEffect, useState } from 'react'
import type { LaunchRow } from '../lib/launchpad'
import { parseTokenURI, type TokenMetadata } from '../lib/metadata'
import { formatUsd6, formatUnits18, timeAgo, shortAddress } from '../lib/format'
import { TokenImage } from './TokenImage'

export function Delta({ mcapUsd6, startMcUsd6 }: { mcapUsd6: bigint; startMcUsd6: bigint | null }) {
  if (!startMcUsd6 || startMcUsd6 === 0n) return null
  const ratio = Number(mcapUsd6) / Number(startMcUsd6)
  if (!Number.isFinite(ratio)) return null
  const up = ratio >= 1
  const label = ratio >= 2 ? `${ratio.toFixed(1)}x` : `${up ? '+' : '−'}${Math.abs((ratio - 1) * 100).toFixed(1)}%`
  return <span className={`font-mono text-[11px] ${up ? 'text-up' : 'text-down'}`}>{label}</span>
}

const GRID = 'grid grid-cols-[1fr_auto] items-center gap-3 sm:grid-cols-[2.2fr_1.3fr_1.3fr_1.5fr_0.9fr_auto]'

export function TokenRowHeader() {
  return (
    <div className={`${GRID} border-b border-hair px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ghost`}>
      <span>Token</span>
      <span className="hidden sm:block">Mcap</span>
      <span className="hidden sm:block">Fees</span>
      <span className="hidden sm:block">Creator</span>
      <span className="hidden sm:block">Age</span>
      <span className="sm:w-12" />
    </div>
  )
}

export function TokenRow({ row, index, startMcUsd6, hypeUsd6 }: { row: LaunchRow; index: number; startMcUsd6: bigint | null; hypeUsd6: bigint | null }) {
  const [meta, setMeta] = useState<TokenMetadata>({})

  useEffect(() => {
    let alive = true
    void parseTokenURI(row.tokenURI).then((m) => alive && setMeta(m))
    return () => {
      alive = false
    }
  }, [row.tokenURI])

  const feesUsd = hypeUsd6 !== null ? (row.lifetimeFeesHype * hypeUsd6) / 10n ** 18n : null

  return (
    <a
      href={`#/t/${row.token}`}
      className={`rise-in ${GRID} group px-4 py-3.5 no-underline transition-colors hover:bg-panel2/60 ${index > 0 ? 'border-t border-hair' : ''}`}
      style={{ animationDelay: `${Math.min(index, 14) * 30}ms` }}
    >
      <span className="flex min-w-0 items-center gap-3">
        <TokenImage src={meta.image} symbol={row.symbol} size="md" />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-bold text-fg sm:hidden">{row.name}</span>
            <span className="hidden truncate text-sm font-bold text-fg sm:inline">{row.symbol}</span>
            {row.positionWithdrawn && (
              <span className="rounded bg-downsoft px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-down">delisted</span>
            )}
          </span>
          <span className="block truncate font-mono text-xs text-ghost sm:hidden">{row.symbol}</span>
          <span className="hidden truncate text-xs text-ghost sm:block">{row.name}</span>
        </span>
      </span>

      <span className="hidden sm:block">
        <span className="block font-mono text-sm text-fg">{formatUsd6(row.marketCapUsd6)}</span>
        <Delta mcapUsd6={row.marketCapUsd6} startMcUsd6={startMcUsd6} />
      </span>

      <span className="hidden font-mono text-sm text-fg sm:block">
        {row.lifetimeFeesHype > 0n ? (
          <>
            {feesUsd !== null ? formatUsd6(feesUsd) : `${formatUnits18(row.lifetimeFeesHype)} HYPE`}
            <span className="block text-[11px] text-ghost">{formatUnits18(row.lifetimeFeesHype)} HYPE</span>
          </>
        ) : (
          <span className="text-ghost">—</span>
        )}
      </span>

      <span className="hidden font-mono text-xs text-dim sm:block">{shortAddress(row.creator)}</span>

      <span className="hidden font-mono text-xs text-ghost sm:block">{timeAgo(row.createdAt)}</span>

      {/* mobile: mcap inline; desktop: arrow */}
      <span className="text-right sm:hidden">
        <span className="block font-mono text-sm text-fg">{formatUsd6(row.marketCapUsd6)}</span>
        <Delta mcapUsd6={row.marketCapUsd6} startMcUsd6={startMcUsd6} />
      </span>
      <span className="hidden justify-end font-mono text-sm text-ghost transition-colors group-hover:text-acc sm:flex">→</span>
    </a>
  )
}

export function TokenRowSkeleton({ index }: { index: number }) {
  return (
    <div className={`${GRID} px-4 py-3.5 ${index > 0 ? 'border-t border-hair' : ''}`}>
      <span className="flex items-center gap-3">
        <span className="shimmer h-10 w-10 rounded-xl" />
        <span className="space-y-1.5">
          <span className="shimmer block h-3.5 w-16 rounded" />
          <span className="shimmer block h-3 w-24 rounded" />
        </span>
      </span>
      <span className="shimmer hidden h-8 w-20 rounded sm:block" />
      <span className="shimmer hidden h-8 w-20 rounded sm:block" />
      <span className="shimmer hidden h-4 w-24 rounded sm:block" />
      <span className="shimmer hidden h-4 w-10 rounded sm:block" />
      <span className="shimmer h-7 w-12 rounded" />
    </div>
  )
}
