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
