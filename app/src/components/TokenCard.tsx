import { useEffect, useState } from 'react'
import type { LaunchRow } from '../lib/launchpad'
import { parseTokenURI, type TokenMetadata } from '../lib/metadata'
import { formatUsd6, formatUnits18, timeAgo, shortAddress } from '../lib/format'
import { TokenImage } from './TokenImage'

export function TokenCard({ row, index }: { row: LaunchRow; index: number }) {
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
      className="rise-in group block rounded-2xl bg-ink-850/80 p-5 no-underline ring-1 ring-ink-700 backdrop-blur transition hover:-translate-y-0.5 hover:ring-mint-500/50"
      style={{ animationDelay: `${Math.min(index, 12) * 50}ms` }}
    >
      <div className="flex items-start gap-3">
        <TokenImage src={meta.image} symbol={row.symbol} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-bold leading-tight text-fog-100 group-hover:text-mint-300">
            {row.name}
            <span className="ml-1.5 font-mono text-xs font-medium text-fog-500">${row.symbol}</span>
          </h3>
          <p className="mt-0.5 line-clamp-1 text-[13px] text-fog-300">{meta.description || ' '}</p>
        </div>
        {row.positionWithdrawn && (
          <span className="rounded bg-rose-soft/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-soft">
            delisted
          </span>
        )}
      </div>

      <div className="mt-5 flex items-baseline justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-fog-500">Market cap</p>
          <p className="mt-0.5 font-mono text-sm font-semibold text-fog-100">{formatUsd6(row.marketCapUsd6)}</p>
        </div>
        <div className="text-right">
          <p className="font-mono text-[10px] uppercase tracking-wider text-fog-500">Fees earned</p>
          <p className="mt-0.5 font-mono text-sm font-semibold text-mint-400">{formatUnits18(row.lifetimeFeesHype)} HYPE</p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between font-mono text-[11px] text-fog-500">
        <span>by {shortAddress(row.creator)}</span>
        <span>{timeAgo(row.createdAt)}</span>
      </div>
    </a>
  )
}

export function TokenCardSkeleton({ index }: { index: number }) {
  return (
    <div
      className="rise-in animate-pulse rounded-2xl bg-ink-850/60 p-5 ring-1 ring-ink-700"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-xl bg-ink-700" />
        <div className="flex-1 space-y-2">
          <div className="h-3.5 w-1/2 rounded bg-ink-700" />
          <div className="h-3 w-3/4 rounded bg-ink-700/70" />
        </div>
      </div>
      <div className="mt-6 flex justify-between">
        <div className="h-8 w-20 rounded bg-ink-700/70" />
        <div className="h-8 w-20 rounded bg-ink-700/70" />
      </div>
      <div className="mt-4 h-3 w-full rounded bg-ink-700/50" />
    </div>
  )
}
