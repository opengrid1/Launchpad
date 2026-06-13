import { formatEther } from 'viem'

/** 1234567 -> "1.23M", 1234 -> "1,234" — for token amounts already in display units. */
export function compactNumber(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (value >= 1e9) return `${trimZeros((value / 1e9).toFixed(2))}B`
  if (value >= 1e6) return `${trimZeros((value / 1e6).toFixed(2))}M`
  if (value >= 1e4) return `${trimZeros((value / 1e3).toFixed(1))}K`
  if (value >= 1) return value.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (value === 0) return '0'
  return value.toLocaleString('en-US', { maximumSignificantDigits: 3 })
}

/** Wei (bigint) -> compact HYPE/token display. */
export function formatUnits18(wei: bigint, opts?: { compact?: boolean; digits?: number }): string {
  const n = Number(formatEther(wei))
  if (opts?.compact !== false) return compactNumber(n)
  return n.toLocaleString('en-US', { maximumFractionDigits: opts?.digits ?? 4 })
}

/** USD with 6 decimals (contract convention) -> "$4,001.46" / "$1.2M". */
export function formatUsd6(usd6: bigint): string {
  const n = Number(usd6) / 1e6
  if (n >= 1e6) return `$${compactNumber(n)}`
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: n < 1 ? 4 : 2 })
}

/** Price in wei-per-1e18-tokens -> readable HYPE price with sig figs for tiny values. */
export function formatPriceHype(priceWei: bigint): string {
  const n = Number(formatEther(priceWei))
  if (n === 0) return '0'
  if (n >= 0.01) return n.toLocaleString('en-US', { maximumFractionDigits: 4 })
  return n.toLocaleString('en-US', { maximumSignificantDigits: 3 })
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

export function timeAgo(unixSeconds: number): string {
  const s = Math.max(1, Math.floor(Date.now() / 1000) - unixSeconds)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  const mo = Math.floor(d / 30)
  return `${mo}mo ago`
}

function trimZeros(s: string): string {
  return s.replace(/\.?0+$/, '')
}

/** Parse a user-typed decimal amount into wei; returns null when invalid. */
export function parseAmount(input: string): bigint | null {
  const trimmed = input.trim()
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === '' || trimmed === '.') return null
  const [whole = '0', frac = ''] = trimmed.split('.')
  const fracPadded = (frac + '0'.repeat(18)).slice(0, 18)
  try {
    return BigInt(whole) * 10n ** 18n + BigInt(fracPadded)
  } catch {
    return null
  }
}
