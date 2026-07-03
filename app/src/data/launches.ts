import featherDefault from '../assets/feather-default.png'

export type LaunchStatus = 'live'

/**
 * A Sherwood coin. It launches straight into a single-sided Uniswap v3 pool
 * and trades against ETH from block one (bankr style: no presale, no
 * graduation, no refunds). Every buy and sell pays a tax collected from the
 * pool in ETH and split down the middle:
 *   • half is redistributed in ETH to everyone holding the token, and
 *   • half goes in ETH to the coin's creator.
 * All rewards are ETH; RBH is only the chain. Prices are ETH per token.
 */
export interface Launch {
  id: number
  name: string
  symbol: string
  glyph: string // emoji logo, used as the token image when no URI is set
  image?: string // token URI (uploaded image); falls back to the glyph
  tagline: string
  description?: string
  tokenAddress: string // the deployed ERC20 contract
  devBuy?: number // creator's initial buy at launch, in ETH
  socials?: { x?: string; telegram?: string; website?: string }
  priceEth: number // ETH per token (tiny, memecoin-style)
  tokensForSale: number
  tokensForLiquidity: number
  liquidityBps: number

  // the reward engine (all ETH, from the pool tax)
  tradeFeeBps: number // tax taken on every trade, split 50/50
  volume: number // lifetime traded volume in ETH
  rewardsPaid: number // total ETH tax already handed out (both halves)
  holders: number

  createdAgo: string // age since launch
  buyers: number
  status: LaunchStatus
  creator: string

  // what the connected demo wallet holds / can claim (ETH rewards)
  yourTokens: number
  yourHolderRewards: number // claimable ETH, from the holders' half
  yourRebate: number // claimable ETH, from your own trades' half
}

/** Total supply of a coin. */
export const supplyOf = (l: Launch) => l.tokensForSale + l.tokensForLiquidity

/** Rough age in hours from a "12m ago" / "5h ago" / "6d ago" / "1w ago" string. */
export function ageHours(s: string): number {
  if (/now/i.test(s)) return 0
  const m = s.match(/(\d+)\s*([mhdw])/)
  if (!m) return 1e9
  const n = Number(m[1])
  return m[2] === 'm' ? n / 60 : m[2] === 'h' ? n : m[2] === 'd' ? n * 24 : n * 168
}

/** The ETH tax a coin has thrown off, and how it halves. */
export function rewardSplit(l: Launch) {
  const pool = (l.volume * l.tradeFeeBps) / 10_000
  return { pool, toHolders: pool / 2, toCreator: pool / 2 }
}

function hash(str: string): number {
  let h = 0
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h || 1
}

export interface Holder {
  rank: number
  address: string
  pct: number // share of total supply
  rewardsEth: number // their cut of the holders' half
  you?: boolean
}

/** Deterministic top-holder table for a coin (with the connected wallet slotted in). */
export function topHolders(l: Launch, n = 8): Holder[] {
  if (!l.holders) return []
  let s = hash(l.symbol)
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
  const holderPool = rewardSplit(l).toHolders
  const addr = () =>
    '0x' + Math.floor(rand() * 0xffff).toString(16).padStart(4, '0') + '…' + Math.floor(rand() * 0xffff).toString(16).padStart(4, '0')

  // top holders hold ~38% combined, on a decreasing curve
  const weights = Array.from({ length: n }, (_, i) => (1 / (i + 1.5)) * (0.7 + rand() * 0.6))
  const sum = weights.reduce((a, b) => a + b, 0)
  let rows: Holder[] = weights.map((w) => {
    const pct = (w / sum) * 38
    return { rank: 0, address: addr(), pct, rewardsEth: (pct / 100) * holderPool }
  })

  // slot the connected wallet in by its real position
  if (l.yourTokens > 0) {
    const pct = (l.yourTokens / supplyOf(l)) * 100
    rows.push({ rank: 0, address: '0x71b3…9F02', pct, rewardsEth: l.yourHolderRewards, you: true })
  }

  rows.sort((a, b) => b.pct - a.pct)
  return rows.slice(0, n).map((r, i) => ({ ...r, rank: i + 1 }))
}

export const LAUNCHES: Launch[] = [
  {
    id: 12,
    name: 'Greenwood',
    symbol: 'GWD',
    glyph: '🌲',
    tagline: 'The reserve currency of the forest. Hold it, get paid in ETH.',
    priceEth: 0.000000406,
    tokensForSale: 0,
    tokensForLiquidity: 1_000_000_000,
    liquidityBps: 10_000,
    tradeFeeBps: 100,
    volume: 3_100,
    rewardsPaid: 41.2,
    holders: 2610,
    createdAgo: '5h ago',
    buyers: 2610,
    status: 'live',
    creator: '0x71b3…9F02',
    tokenAddress: '0x9c4e…3a71',
    socials: { x: 'https://x.com/greenwood', telegram: 'https://t.me/greenwood', website: 'https://greenwood.fun' },
    description:
      'Greenwood is the reserve currency of the forest. Hold it and a share of the ETH tax from every trade flows to you, block after block. No team allocation, liquidity locked in a single-sided v3 pool.',
    devBuy: 0.5,
    yourTokens: 3_200_000,
    yourHolderRewards: 0.112,
    yourRebate: 0.031,
  },
  {
    id: 13,
    name: 'Longbow',
    symbol: 'BOW',
    glyph: '🏹',
    tagline: 'Range on every trade. Traders get half the ETH tax straight back.',
    priceEth: 0.0000001,
    tokensForSale: 0,
    tokensForLiquidity: 1_000_000_000,
    liquidityBps: 10_000,
    tradeFeeBps: 100,
    volume: 620,
    rewardsPaid: 9.3,
    holders: 540,
    createdAgo: '1d ago',
    buyers: 540,
    status: 'live',
    creator: '0x08aF…b3c2',
    tokenAddress: '0x2f7d…b190',
    socials: { x: 'https://x.com/longbow_eth', website: 'https://longbow.gg' },
    description:
      'Longbow rewards the shooters. Half the ETH tax from every trade is split across holders, the other half goes to the creator who strung the bow.',
    devBuy: 0.2,
    yourTokens: 0,
    yourHolderRewards: 0,
    yourRebate: 0,
  },
  {
    id: 14,
    name: 'Almsbox',
    symbol: 'ALMS',
    glyph: '🪙',
    tagline: 'Take from the volume, give ETH to the holders. That is the whole pitch.',
    priceEth: 0.0000000323,
    tokensForSale: 0,
    tokensForLiquidity: 1_000_000_000,
    liquidityBps: 10_000,
    tradeFeeBps: 100,
    volume: 210,
    rewardsPaid: 5.25,
    holders: 128,
    createdAgo: '3h ago',
    buyers: 128,
    status: 'live',
    creator: '0xDd02…4f19',
    tokenAddress: '0x8ab1…c4e0',
    socials: { website: 'https://almsbox.xyz' },
    description:
      'Almsbox skims the volume and hands it to the holders. A meme with redistribution baked into the pool tax.',
    devBuy: 0.0,
    yourTokens: 0,
    yourHolderRewards: 0,
    yourRebate: 0,
  },
  {
    id: 15,
    name: 'Merrymint',
    symbol: 'MERRY',
    glyph: '🍃',
    tagline: 'A fresh fair-launch meme with a conscience. Just deployed.',
    priceEth: 0.0000000202,
    tokensForSale: 0,
    tokensForLiquidity: 1_000_000_000,
    liquidityBps: 10_000,
    tradeFeeBps: 100,
    volume: 38,
    rewardsPaid: 0.76,
    holders: 62,
    createdAgo: '12m ago',
    buyers: 62,
    status: 'live',
    creator: '0x77Cc…09bE',
    tokenAddress: '0x5e93…af22',
    socials: { x: 'https://x.com/merrymint', telegram: 'https://t.me/merrymint' },
    description:
      'Merrymint is a fair-launch meme with a conscience. Opens soon into a single-sided Uniswap v3 pool.',
    devBuy: 0.3,
    yourTokens: 0,
    yourHolderRewards: 0,
    yourRebate: 0,
  },
  {
    id: 9,
    name: 'Tuck',
    symbol: 'TUCK',
    glyph: '🍺',
    tagline: 'Deep liquidity, steady volume. The ETH keeps flowing to holders.',
    priceEth: 0.0000006875,
    tokensForSale: 0,
    tokensForLiquidity: 1_000_000_000,
    liquidityBps: 10_000,
    tradeFeeBps: 100,
    volume: 4_310,
    rewardsPaid: 86.2,
    holders: 3120,
    createdAgo: '6d ago',
    buyers: 3120,
    status: 'live',
    creator: '0x3fA8…c21D',
    tokenAddress: '0x1d64…7f0c',
    socials: { x: 'https://x.com/tuckcoin', telegram: 'https://t.me/tuck', website: 'https://tuck.beer' },
    description:
      'Tuck runs deep liquidity and steady volume. The ETH tax keeps flowing to a loyal holder base.',
    devBuy: 1.0,
    yourTokens: 1_250_000,
    yourHolderRewards: 0.845,
    yourRebate: 0.242,
  },
  {
    id: 6,
    name: 'Nottingham',
    symbol: 'SHRF',
    glyph: '🛡️',
    tagline: 'Small cap, loyal holders. The sheriff keeps paying out.',
    priceEth: 0.00000000178,
    tokensForSale: 0,
    tokensForLiquidity: 1_000_000_000,
    liquidityBps: 10_000,
    tradeFeeBps: 100,
    volume: 260,
    rewardsPaid: 5.2,
    holders: 214,
    createdAgo: '1w ago',
    buyers: 214,
    status: 'live',
    creator: '0xB00d…5e77',
    tokenAddress: '0x74c2…9e18',
    description:
      'Nottingham is a small-cap with loyal holders. Thin float, but the sheriff keeps paying the ETH tax out.',
    devBuy: 0.0,
    yourTokens: 0,
    yourHolderRewards: 0,
    yourRebate: 0,
  },
]

const fmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })
export function compact(n: number): string {
  if (n >= 1_000_000_000) return fmt.format(n / 1_000_000_000) + 'B'
  if (n >= 1_000_000) return fmt.format(n / 1_000_000) + 'M'
  if (n >= 1_000) return fmt.format(n / 1_000) + 'K'
  return fmt.format(n)
}

/** Per-token price (very small) — keep the significant digits. */
export function price(n: number): string {
  return n.toLocaleString('en-US', { maximumSignificantDigits: 3 })
}

/** An ETH amount: compact when large, precise when small. */
export function eth(n: number): string {
  if (n >= 1000) return compact(n)
  if (n >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (n === 0) return '0'
  return n.toLocaleString('en-US', { maximumSignificantDigits: 2 })
}

/** Default token image when the creator doesn't upload one: the Sherwood
 *  feather emblem — a lime quill on a dark charcoal badge — bundled as a PNG. */
export function defaultTokenImage(_symbol?: string): string {
  return featherDefault
}

/** Reference ETH price used to show fiat values (market cap, etc.) in USD. */
export const ETH_USD = 3200

/** A USD amount, compacted with a leading $. */
export function usd(n: number): string {
  return '$' + compact(n)
}

/** Market cap of a coin in USD, given a live per-token ETH price. */
export const mcapUsd = (priceEth: number, l: Launch) => priceEth * supplyOf(l) * ETH_USD
