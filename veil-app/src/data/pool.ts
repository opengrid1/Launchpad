import type { Denomination } from '../lib/notes'

// Mock pool state — stands in for what a real app would read from the chain
// (deposit count per pool, total value locked, recent commitments/nullifiers).

export interface PoolStat {
  denomination: Denomination
  deposits: number // size of the anonymity set
  tvlHype: number
}

export const POOLS: PoolStat[] = [
  { denomination: 0.1, deposits: 1842, tvlHype: 184.2 },
  { denomination: 1, deposits: 3120, tvlHype: 3120 },
  { denomination: 10, deposits: 671, tvlHype: 6710 },
  { denomination: 100, deposits: 96, tvlHype: 9600 },
]

export function poolFor(denomination: Denomination): PoolStat {
  return POOLS.find((p) => p.denomination === denomination) ?? POOLS[1]
}

export type ActivityKind = 'deposit' | 'withdraw'

export interface Activity {
  kind: ActivityKind
  denomination: Denomination
  ref: string // commitment (deposit) or nullifier hash (withdraw), truncated
  ageMins: number
}

export const RECENT_ACTIVITY: Activity[] = [
  { kind: 'withdraw', denomination: 1, ref: '0x9c41…a7e0', ageMins: 2 },
  { kind: 'deposit', denomination: 10, ref: '0x2fb8…1c9d', ageMins: 6 },
  { kind: 'deposit', denomination: 1, ref: '0x77a3…42ff', ageMins: 11 },
  { kind: 'withdraw', denomination: 0.1, ref: '0x05de…88b1', ageMins: 18 },
  { kind: 'deposit', denomination: 100, ref: '0xe130…5a04', ageMins: 24 },
  { kind: 'withdraw', denomination: 10, ref: '0xbb62…0f37', ageMins: 31 },
]

// Relayer fee taken on a withdraw so the recipient address needs no gas.
export const RELAYER_FEE_BPS = 50 // 0.5%
