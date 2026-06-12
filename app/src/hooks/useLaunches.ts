import { useCallback, useEffect, useRef, useState } from 'react'
import type { Address } from 'viem'
import { fetchLaunches, fetchTokenDetail, type LaunchRow, type TokenDetail } from '../lib/launchpad'

const BOARD_POLL_MS = 15_000
const DETAIL_POLL_MS = 10_000

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
