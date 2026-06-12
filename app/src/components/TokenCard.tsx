import { useEffect, useState } from 'react'
import type { LaunchRow } from '../lib/launchpad'
import { parseTokenURI, type TokenMetadata } from '../lib/metadata'
import { formatUsd6, formatUnits18, timeAgo } from '../lib/format'
import { TokenCover } from './TokenImage'

/** Performance vs the launch market cap, e.g. 2.4x / -38%. */
function Performance({ mcapUsd6, startMcUsd6 }: { mcapUsd6: bigint; startMcUsd6: bigint | null }) {
  if (!startMcUsd6 || startMcUsd6 === 0n) return null
  const ratio = Number(mcapUsd6) / Number(startMcUsd6)
  if (!Number.isFinite(ratio)) return null
  const up = ratio >= 1
  const label = ratio >= 2 ? `${ratio.toFixed(1)}x` : `${up ? '+' : ''}${((ratio - 1) * 100).toFixed(0)}%`
  return (
    <span
      className={`rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold ${
        up ? 'bg-mint-500/10 text-mint-400' : 'bg-rose-soft/10 text-rose-soft'
      }`}
      title="vs launch market cap"
    >
      {label}
    </span>
  )
}

export function TokenCard({ row, index, startMcUsd6 }: { row: LaunchRow; index: number; startMcUsd6: bigint | null }) {
  const [meta, setMeta] = useState<TokenMetadata>({})

  useEffect(() => {
    let alive = true
    void parseTokenURI(row.tokenURI).then((m) => alive && setMeta(m))
    return () => {
      alive = false
    }
  }, [row.tokenURI])

  return (
    <a
      href={`#/t/${row.token}`}
      className="rise-in group block overflow-hidden rounded-2xl bg-ink-850/80 no-underline ring-1 ring-ink-700 transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_32px_-12px_rgba(43,199,160,0.25)] hover:ring-mint-500/50"
      style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}
    >
      <TokenCover src={meta.image} symbol={row.symbol} />

      <div className="p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="truncate text-[15px] font-bold leading-tight text-fog-100 group-hover:text-mint-300">{row.name}</h3>
          {row.positionWithdrawn ? (
            <span className="rounded bg-rose-soft/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-soft">
              delisted
            </span>
          ) : (
            <Performance mcapUsd6={row.marketCapUsd6} startMcUsd6={startMcUsd6} />
          )}
        </div>
        <p className="mt-0.5 font-mono text-xs text-fog-500">
          ${row.symbol} · {timeAgo(row.createdAt)}
        </p>

        <div className="mt-3 flex items-baseline justify-between border-t border-ink-700/60 pt-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-fog-500">mcap</p>
            <p className="mt-0.5 font-mono text-sm font-semibold text-fog-100">{formatUsd6(row.marketCapUsd6)}</p>
          </div>
          <div className="text-right">
            <p className="font-mono text-[10px] uppercase tracking-wider text-fog-500">fees</p>
            <p className="mt-0.5 font-mono text-sm font-semibold text-mint-400">
              {row.lifetimeFeesHype > 0n ? `${formatUnits18(row.lifetimeFeesHype)} ♦` : '—'}
            </p>
          </div>
        </div>
      </div>
    </a>
  )
}

export function TokenCardSkeleton({ index }: { index: number }) {
  return (
    <div className="rise-in overflow-hidden rounded-2xl ring-1 ring-ink-700" style={{ animationDelay: `${index * 40}ms` }}>
      <div className="shimmer aspect-square w-full" />
      <div className="space-y-2.5 p-4">
        <div className="h-4 w-2/3 rounded bg-ink-700" />
        <div className="h-3 w-1/3 rounded bg-ink-700/70" />
        <div className="flex justify-between border-t border-ink-700/60 pt-3">
          <div className="h-8 w-16 rounded bg-ink-700/70" />
          <div className="h-8 w-16 rounded bg-ink-700/70" />
        </div>
      </div>
    </div>
  )
}
