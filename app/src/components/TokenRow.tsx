import { useEffect, useState } from 'react'
import type { LaunchRow } from '../lib/launchpad'
import { parseTokenURI, type TokenMetadata } from '../lib/metadata'
import { formatUsd6, formatUnits18, timeAgo, shortAddress } from '../lib/format'
import { TokenImage } from './TokenImage'

export function PerfBadge({ mcapUsd6, startMcUsd6 }: { mcapUsd6: bigint; startMcUsd6: bigint | null }) {
  if (!startMcUsd6 || startMcUsd6 === 0n) return null
  const ratio = Number(mcapUsd6) / Number(startMcUsd6)
  if (!Number.isFinite(ratio)) return null
  const up = ratio >= 1
  const label = ratio >= 2 ? `${ratio.toFixed(1)}x` : `${up ? '↑' : '↓'} ${Math.abs((ratio - 1) * 100).toFixed(1)}%`
  return <span className={`font-mono text-[11px] font-semibold ${up ? 'text-pos' : 'text-neg'}`}>{label}</span>
}

const GRID = 'grid grid-cols-[1fr_auto] items-center gap-3 sm:grid-cols-[2.2fr_1.3fr_1.3fr_1.5fr_0.9fr_auto]'

export function TokenRowHeader() {
  return (
    <div className={`${GRID} border-b border-line px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-faint`}>
      <span>Coin</span>
      <span className="hidden sm:block">Mcap</span>
      <span className="hidden sm:block">Fees earned</span>
      <span className="hidden sm:block">Creator</span>
      <span className="hidden sm:block">Age</span>
      <span className="sm:w-[72px]" />
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
      className={`rise-in ${GRID} group px-4 py-3 no-underline transition-colors hover:bg-card-2/60 ${index > 0 ? 'border-t border-line' : ''}`}
      style={{ animationDelay: `${Math.min(index, 14) * 30}ms` }}
    >
      <span className="flex min-w-0 items-center gap-3">
        <TokenImage src={meta.image} symbol={row.symbol} size="md" />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            {/* mobile mirrors flaunch: name bold over ticker; desktop: ticker bold over name */}
            <span className="truncate text-sm font-bold text-ink sm:hidden">{row.name}</span>
            <span className="hidden truncate text-sm font-bold text-ink sm:inline">{row.symbol}</span>
            {row.positionWithdrawn && (
              <span className="rounded bg-neg-soft px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-neg">delisted</span>
            )}
          </span>
          <span className="block truncate text-xs text-sub sm:hidden">{row.symbol}</span>
          <span className="hidden truncate text-xs text-sub sm:block">{row.name}</span>
        </span>
      </span>

      <span className="hidden sm:block">
        <span className="block font-mono text-sm font-semibold text-ink">{formatUsd6(row.marketCapUsd6)}</span>
        <PerfBadge mcapUsd6={row.marketCapUsd6} startMcUsd6={startMcUsd6} />
      </span>

      <span className="hidden font-mono text-sm text-ink sm:block">
        {row.lifetimeFeesHype > 0n ? (
          <>
            {feesUsd !== null ? formatUsd6(feesUsd) : `${formatUnits18(row.lifetimeFeesHype)} HYPE`}
            <span className="block text-[11px] text-faint">{formatUnits18(row.lifetimeFeesHype)} HYPE</span>
          </>
        ) : (
          <span className="text-faint">—</span>
        )}
      </span>

      <span className="hidden items-center gap-2 sm:flex">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-card-2 font-mono text-[9px] font-semibold text-sub ring-1 ring-line">
          {row.creator.slice(2, 4)}
        </span>
        <span className="font-mono text-xs text-sub">{shortAddress(row.creator)}</span>
      </span>

      <span className="hidden font-mono text-xs text-sub sm:block">{timeAgo(row.createdAt)}</span>

      {/* mobile: mcap inline; desktop: trade button */}
      <span className="text-right sm:hidden">
        <span className="block font-mono text-sm font-semibold text-ink">{formatUsd6(row.marketCapUsd6)}</span>
        <PerfBadge mcapUsd6={row.marketCapUsd6} startMcUsd6={startMcUsd6} />
      </span>
      <span className="hidden justify-end sm:flex">
        <span className="rounded-full px-4 py-1.5 text-xs font-bold text-ink ring-1 ring-line-strong transition group-hover:bg-night group-hover:text-white group-hover:ring-night">
          Trade
        </span>
      </span>
    </a>
  )
}

export function TokenRowSkeleton({ index }: { index: number }) {
  return (
    <div className={`${GRID} px-4 py-3 ${index > 0 ? 'border-t border-line' : ''}`}>
      <span className="flex items-center gap-3">
        <span className="shimmer h-10 w-10 rounded-xl" />
        <span className="space-y-1.5">
          <span className="shimmer block h-3.5 w-16 rounded" />
          <span className="shimmer block h-3 w-24 rounded" />
        </span>
      </span>
      <span className="shimmer hidden h-8 w-20 rounded sm:block" />
      <span className="shimmer hidden h-8 w-20 rounded sm:block" />
      <span className="shimmer hidden h-6 w-24 rounded sm:block" />
      <span className="shimmer hidden h-4 w-10 rounded sm:block" />
      <span className="shimmer h-7 w-[72px] rounded-full" />
    </div>
  )
}
