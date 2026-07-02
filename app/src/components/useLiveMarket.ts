import { useEffect, useRef, useState } from 'react'

export interface Market {
  price: number
  points: number[]
  changePct: number
}

function hash(str: string): number {
  let h = 0
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h || 1
}

/** Deterministic seeded random walk for the initial series (stable first paint). */
function seedSeries(seed: string, base: number, n: number): number[] {
  let s = hash(seed)
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
  const out: number[] = []
  let v = base
  for (let i = 0; i < n; i++) {
    v = Math.max(base * 0.35, v + (rand() - 0.47) * base * 0.03)
    out.push(v)
  }
  return out
}

/**
 * A live market feed. Seeds a stable series, then walks the last point every
 * `interval` ms so the chart and price tick without any page refresh.
 */
export function useLiveMarket(seed: string, base: number, count = 64, interval = 1200): Market {
  const [points, setPoints] = useState<number[]>(() => seedSeries(seed, base, count))
  const baseRef = useRef(base)
  baseRef.current = base

  useEffect(() => {
    const id = setInterval(() => {
      setPoints((prev) => {
        const b = baseRef.current
        const last = prev[prev.length - 1]
        const drift = (Math.random() - 0.485) * b * 0.02
        const next = Math.max(b * 0.3, last + drift)
        return [...prev.slice(1), next]
      })
    }, interval)
    return () => clearInterval(id)
  }, [interval])

  const price = points[points.length - 1]
  const changePct = ((price - points[0]) / points[0]) * 100
  return { price, points, changePct }
}

export interface Trade {
  id: number
  side: 'buy' | 'sell'
  who: string
  amount: string
  when: number
}

const ADDRS = ['0x9f…2a1d', '0x3c…88fe', '0x71…9F02', '0xaa…04c1', '0x5d…4a0b', '0x08…b3c2', '0xdd…4f19']

/** A live trade tape. Pushes a synthetic buy/sell every few seconds. */
export function useLiveTrades(seed: string, max = 14): Trade[] {
  const [trades, setTrades] = useState<Trade[]>([])
  const nextId = useRef(0)

  useEffect(() => {
    setTrades([])
    let s = hash(seed)
    const rand = () => {
      s = (s * 1664525 + 1013904223) >>> 0
      return s / 4294967296
    }
    const make = (): Trade => {
      const side = rand() > 0.48 ? 'buy' : 'sell'
      const amt = Math.floor(rand() * 4000) + 40
      return {
        id: nextId.current++,
        side,
        who: ADDRS[Math.floor(rand() * ADDRS.length)],
        amount: `${amt.toLocaleString()} RBH`,
        when: Date.now(),
      }
    }
    setTrades(Array.from({ length: 6 }, make))
    const id = setInterval(() => {
      setTrades((prev) => [make(), ...prev].slice(0, max))
    }, 2600)
    return () => clearInterval(id)
  }, [seed, max])

  return trades
}
