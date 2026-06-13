const GT = 'https://api.geckoterminal.com/api/v2/networks/hyperevm'

export type Trade = {
  kind: 'buy' | 'sell'
  usd: number
  tokenAmount: number
  priceUsd: number
  from: string
  ts: number
  txHash: string
}

/** Recent swaps for a pool from GeckoTerminal (newest first). */
export async function fetchTrades(pool: string): Promise<Trade[]> {
  try {
    const res = await fetch(`${GT}/pools/${pool}/trades`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return []
    const json = (await res.json()) as { data?: Array<{ attributes?: Record<string, string> }> }
    return (json.data ?? []).map((t) => {
      const a = t.attributes ?? {}
      const kind = a.kind === 'buy' ? 'buy' : 'sell'
      const priceUsd = Number(a.price_to_in_usd ?? a.price_from_in_usd ?? 0)
      const usd = Number(a.volume_in_usd ?? 0)
      const tokenAmount = Number((kind === 'buy' ? a.to_token_amount : a.from_token_amount) ?? (priceUsd ? usd / priceUsd : 0))
      return {
        kind,
        usd,
        tokenAmount,
        priceUsd,
        from: (a.tx_from_address ?? '').toLowerCase(),
        ts: Math.floor(Date.parse(a.block_timestamp ?? '') / 1000) || 0,
        txHash: a.tx_hash ?? '',
      }
    })
  } catch {
    return []
  }
}

/**
 * 24h volume per pool from GeckoTerminal's public API (they index HyperEVM swaps;
 * there's no on-chain volume to read). Batched up to 30 pools per request.
 */
export async function fetchVolumes(pools: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (let i = 0; i < pools.length; i += 30) {
    const batch = pools.slice(i, i + 30)
    const url = `https://api.geckoterminal.com/api/v2/networks/hyperevm/pools/multi/${batch.join(',')}`
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) })
      if (!res.ok) continue
      const json = (await res.json()) as { data?: Array<{ attributes?: { address?: string; volume_usd?: { h24?: string } } }> }
      for (const pool of json.data ?? []) {
        const addr = pool.attributes?.address?.toLowerCase()
        const vol = Number(pool.attributes?.volume_usd?.h24 ?? 0)
        if (addr) out[addr] = Number.isFinite(vol) ? vol : 0
      }
    } catch {
      /* leave missing pools out — they render as no volume */
    }
  }
  return out
}
