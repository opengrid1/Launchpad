import { useEffect, useState } from 'react'
import type { LaunchRow } from '../lib/launchpad'
import { parseTokenURI, type TokenMetadata } from '../lib/metadata'
import { compactNumber, formatUsd6, shortAddress } from '../lib/format'
import { TokenImage } from './TokenImage'
import { SocialIcons } from './SocialIcons'
import { Sparkline } from './Sparkline'

export function Delta({ mcapUsd6, startMcUsd6 }: { mcapUsd6: bigint; startMcUsd6: bigint | null }) {
  if (!startMcUsd6 || startMcUsd6 === 0n) return null
  const ratio = Number(mcapUsd6) / Number(startMcUsd6)
  if (!Number.isFinite(ratio)) return null
  const up = ratio >= 1
  const label = ratio >= 2 ? `${ratio.toFixed(1)}x` : `${up ? '+' : '−'}${Math.abs((ratio - 1) * 100).toFixed(1)}%`
  return <span className={`font-mono text-[11px] ${up ? 'text-up' : 'text-down'}`}>{label}</span>
}

const GRID = 'grid grid-cols-[1fr_auto_auto] items-center gap-3 sm:grid-cols-[2.7fr_1.1fr_1fr_1.3fr_auto]'

function fmtVol(v: number | undefined): string {
  if (v === undefined) return '—'
  if (v < 0.01) return '$0'
  return `$${compactNumber(v)}`
}

export function TokenRowHeader() {
  return (
    <div className={`${GRID} border-b border-hair px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ghost`}>
      <span>Token</span>
      <span className="hidden text-right sm:block">Mcap</span>
      <span className="hidden text-right sm:block">Volume</span>
      <span className="hidden text-right sm:block">7d</span>
      <span className="sm:w-[68px]" />
    </div>
  )
}

export function TokenRow({
  row,
  index,
  startMcUsd6,
  hypeUsd6,
  volume,
  sparkline,
}: {
  row: LaunchRow
  index: number
  startMcUsd6: bigint | null
  hypeUsd6: bigint | null
  volume?: number
  sparkline?: number[]
}) {
  const [meta, setMeta] = useState<TokenMetadata>({})

  useEffect(() => {
    let alive = true
    void parseTokenURI(row.tokenURI).then((m) => alive && setMeta(m))
    return () => {
      alive = false
    }
  }, [row.tokenURI])

  void hypeUsd6
  const stop = (e: React.MouseEvent) => e.stopPropagation()

  return (
    <div
      onClick={() => (window.location.hash = `#/t/${row.token}`)}
      className={`${GRID} group cursor-pointer px-4 py-3 transition-colors hover:bg-panel2/50 ${index > 0 ? 'border-t border-hair' : ''}`}
    >
      {/* token */}
      <span className="flex min-w-0 items-center gap-3">
        <span className="hidden w-5 shrink-0 text-right font-mono text-xs text-ghost sm:block">{index + 1}</span>
        <TokenImage src={meta.image} symbol={row.symbol} size="md" />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-bold text-fg">{row.name}</span>
            {row.positionWithdrawn && (
              <span className="rounded bg-downsoft px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-down">delisted</span>
            )}
            <span className="hidden sm:inline">
              <SocialIcons meta={meta} compact onClick={stop} />
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-xs text-ghost">${row.symbol}</span>
            <span className="sm:hidden">
              <SocialIcons meta={meta} compact onClick={stop} />
            </span>
          </span>
          <span className="mt-0.5 block truncate font-mono text-[11px] text-ghost sm:hidden">
            by {shortAddress(row.creator)} · Vol {fmtVol(volume)}
          </span>
        </span>
      </span>

      {/* mcap (desktop) */}
      <span className="hidden text-right sm:block">
        <span className="block font-mono text-sm text-fg">{formatUsd6(row.marketCapUsd6)}</span>
        <Delta mcapUsd6={row.marketCapUsd6} startMcUsd6={startMcUsd6} />
      </span>

      {/* volume (desktop) */}
      <span className="hidden text-right font-mono text-sm text-fg sm:block">{fmtVol(volume)}</span>

      {/* sparkline */}
      <span className="flex w-16 justify-end sm:w-auto sm:px-2">
        <Sparkline data={sparkline} className="h-9 w-16 sm:w-full" />
      </span>

      {/* mcap (mobile) */}
      <span className="text-right sm:hidden">
        <span className="block font-mono text-sm text-fg">{formatUsd6(row.marketCapUsd6)}</span>
        <Delta mcapUsd6={row.marketCapUsd6} startMcUsd6={startMcUsd6} />
      </span>

      {/* trade (desktop) */}
      <span className="hidden justify-end sm:flex">
        <span className="rounded-lg px-3.5 py-1.5 text-xs font-bold text-acc ring-1 ring-acc/30 transition group-hover:bg-acc group-hover:text-base">
          Trade
        </span>
      </span>
    </div>
  )
}

export function TokenRowSkeleton({ index }: { index: number }) {
  return (
    <div className={`${GRID} px-4 py-3 ${index > 0 ? 'border-t border-hair' : ''}`}>
      <span className="flex items-center gap-3">
        <span className="shimmer h-10 w-10 rounded-xl" />
        <span className="space-y-1.5">
          <span className="shimmer block h-3.5 w-20 rounded" />
          <span className="shimmer block h-3 w-24 rounded" />
        </span>
      </span>
      <span className="shimmer hidden h-8 w-20 justify-self-end rounded sm:block" />
      <span className="shimmer hidden h-4 w-16 justify-self-end rounded sm:block" />
      <span className="shimmer h-9 w-16 rounded sm:w-full" />
      <span className="shimmer hidden h-7 w-[68px] rounded sm:block" />
    </div>
  )
}
