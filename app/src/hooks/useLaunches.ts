import { useCallback, useEffect, useRef, useState } from 'react'
import type { Address } from 'viem'
import { fetchLaunches, fetchTokenDetail, type LaunchRow, type TokenDetail } from '../lib/launchpad'
import { publicClient } from '../lib/chain'
import { LAUNCHPAD, launchpadAbi } from '../lib/contracts'

const BOARD_POLL_MS = 6_000
const DETAIL_POLL_MS = 4_000

export function useLaunches() {
  const [rows, setRows] = useState<LaunchRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setRows(await fetchLaunches())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  usePoll(load, BOARD_POLL_MS)
  return { rows, error, refresh: load }
}

export function useTokenDetail(token: Address | null) {
  const [detail, setDetail] = useState<TokenDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!token) return
    try {
      setDetail(await fetchTokenDetail(token))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [token])

  usePoll(load, DETAIL_POLL_MS)
  return { detail, error, refresh: load }
}

/** Run immediately, then on an interval; pauses when the tab is hidden. */
function usePoll(fn: () => Promise<void>, ms: number) {
  const fnRef = useRef(fn)
  useEffect(() => {
    fnRef.current = fn
  }, [fn])
  useEffect(() => {
    let timer: number | undefined
    let cancelled = false
    const tick = async () => {
      if (document.visibilityState === 'visible') await fnRef.current()
      if (!cancelled) timer = window.setTimeout(tick, ms)
    }
    void tick()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [fn, ms])
}

/** Live HYPE/USD (6dp) + the platform's configured launch market cap. */
export function usePlatformStats() {
  const [stats, setStats] = useState<{ hypeUsd6: bigint; startMcUsd6: bigint } | null>(null)
  const load = useCallback(async () => {
    try {
      const [hypeUsd6, startMcUsd6] = await Promise.all([
        publicClient.readContract({ address: LAUNCHPAD, abi: launchpadAbi, functionName: 'hypeUsdPrice' }),
        publicClient.readContract({ address: LAUNCHPAD, abi: launchpadAbi, functionName: 'startingMarketCapUsd6' }),
      ])
      setStats({ hypeUsd6, startMcUsd6 })
    } catch {
      /* keep last value */
    }
  }, [])
  usePoll(load, 30_000)
  return stats
}
