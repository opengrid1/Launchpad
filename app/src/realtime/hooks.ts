import { useEffect, useState } from 'react'
import { realtime, type Activity, type Market } from './store'
import type { Launch } from '../data/launches'

/** Subscribe to the live coin list (updates when a coin is launched). */
export function useCoins(): Launch[] {
  const [coins, setCoins] = useState<Launch[]>(() => realtime.getCoins())
  useEffect(() => realtime.subscribe('board', () => setCoins(realtime.getCoins())), [])
  return coins
}

/** Subscribe to one coin's live market (price, candles, trades) — pushed each tick. */
export function useMarket(id: number): Market {
  const [m, setM] = useState<Market>(() => realtime.getMarket(id))
  useEffect(() => {
    setM(realtime.getMarket(id))
    return realtime.subscribe(`market:${id}`, () => setM(realtime.getMarket(id)))
  }, [id])
  return m
}

/** Subscribe to the global activity/notification stream. */
export function useActivity(): Activity[] {
  const [a, setA] = useState<Activity[]>(() => realtime.getActivity())
  useEffect(() => realtime.subscribe('activity', () => setA([...realtime.getActivity()])), [])
  return a
}
