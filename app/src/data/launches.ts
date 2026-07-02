export type LaunchStatus = 'live' | 'upcoming' | 'graduated' | 'refunding'

/**
 * A Sherwood launch. Same fixed-price sale as before, but every token that
 * graduates carries a standing trade fee that gets split down the middle:
 *   • half is redistributed to everyone holding the token (the many), and
 *   • half is rebated straight back to whoever made the trade (you).
 * That 50/50 is the whole point — hence the `feeBps` + reward fields below.
 */
export interface Launch {
  id: number
  name: string
  symbol: string
  glyph: string
  tagline: string
  priceRbh: number // RBH per token — flat, first buyer to last
  tokensForSale: number
  tokensForLiquidity: number
  raised: number // RBH
  softCap: number // RBH
  startsIn?: string
  endsIn?: string
  endedAgo?: string
  liquidityBps: number
  maxBuyPerWallet: number // RBH, 0 = unlimited

  // the reward engine
  tradeFeeBps: number // fee taken on every trade once graduated (split 50/50)
  volume: number // lifetime traded volume in RBH (drives rewards)
  rewardsPaid: number // total RBH already handed out (both halves)
  holders: number

  buyers: number
  status: LaunchStatus
  creator: string

  // what the connected demo wallet holds / can claim
  yourContribution: number
  yourTokens: number
  yourHolderRewards: number // claimable, from the holders' half
  yourRebate: number // claimable, from your own trades' half
}

export const hardCapOf = (l: Launch) => l.priceRbh * l.tokensForSale

/** The reward pool a launch has thrown off, and how it halves. */
export function rewardSplit(l: Launch) {
  const pool = (l.volume * l.tradeFeeBps) / 10_000
  return { pool, toHolders: pool / 2, toTraders: pool / 2 }
}

export const LAUNCHES: Launch[] = [
  {
    id: 12,
    name: 'Greenwood',
    symbol: 'GWD',
    glyph: '🌲',
    tagline: 'The reserve currency of the forest. Hold it, get paid to.',
    priceRbh: 0.0006,
    tokensForSale: 500_000_000,
    tokensForLiquidity: 400_000_000,
    raised: 214_800,
    softCap: 80_000,
    endsIn: '11h 40m',
    liquidityBps: 7000,
    maxBuyPerWallet: 3_000,
    tradeFeeBps: 200,
    volume: 1_920_000,
    rewardsPaid: 38_400,
    holders: 2610,
    buyers: 2610,
    status: 'live',
    creator: '0x71b3…9F02',
    yourContribution: 300,
    yourTokens: 500_000,
    yourHolderRewards: 46.2,
    yourRebate: 12.8,
  },
  {
    id: 13,
    name: 'Longbow',
    symbol: 'BOW',
    glyph: '🏹',
    tagline: 'Range on every trade. Traders get half their fee straight back.',
    priceRbh: 0.011,
    tokensForSale: 9_000_000,
    tokensForLiquidity: 7_000_000,
    raised: 52_300,
    softCap: 35_000,
    endsIn: '2d 3h',
    liquidityBps: 8000,
    maxBuyPerWallet: 800,
    tradeFeeBps: 150,
    volume: 640_000,
    rewardsPaid: 9_600,
    holders: 540,
    buyers: 540,
    status: 'live',
    creator: '0x08aF…b3c2',
    yourContribution: 0,
    yourTokens: 0,
    yourHolderRewards: 0,
    yourRebate: 0,
  },
  {
    id: 14,
    name: 'Almsbox',
    symbol: 'ALMS',
    glyph: '🪙',
    tagline: 'Take from the volume, give to the holders. That is the entire pitch.',
    priceRbh: 0.0025,
    tokensForSale: 60_000_000,
    tokensForLiquidity: 60_000_000,
    raised: 19_400,
    softCap: 45_000,
    endsIn: '8h 12m',
    liquidityBps: 9000,
    maxBuyPerWallet: 0,
    tradeFeeBps: 250,
    volume: 210_000,
    rewardsPaid: 5_250,
    holders: 128,
    buyers: 128,
    status: 'live',
    creator: '0xDd02…4f19',
    yourContribution: 0,
    yourTokens: 0,
    yourHolderRewards: 0,
    yourRebate: 0,
  },
  {
    id: 15,
    name: 'Merrymint',
    symbol: 'MERRY',
    glyph: '🍃',
    tagline: 'A fair-launch meme with a conscience. Opens soon.',
    priceRbh: 0.008,
    tokensForSale: 14_000_000,
    tokensForLiquidity: 10_000_000,
    raised: 0,
    softCap: 30_000,
    startsIn: '1d 06h',
    liquidityBps: 7500,
    maxBuyPerWallet: 600,
    tradeFeeBps: 200,
    volume: 0,
    rewardsPaid: 0,
    holders: 0,
    buyers: 0,
    status: 'upcoming',
    creator: '0x77Cc…09bE',
    yourContribution: 0,
    yourTokens: 0,
    yourHolderRewards: 0,
    yourRebate: 0,
  },
  {
    id: 9,
    name: 'Tuck',
    symbol: 'TUCK',
    glyph: '🍺',
    tagline: 'Graduated last week. The rewards are already flowing.',
    priceRbh: 0.004,
    tokensForSale: 35_000_000,
    tokensForLiquidity: 28_000_000,
    raised: 140_000,
    softCap: 60_000,
    endedAgo: '6d ago',
    liquidityBps: 7000,
    maxBuyPerWallet: 1_200,
    tradeFeeBps: 200,
    volume: 4_310_000,
    rewardsPaid: 86_200,
    holders: 3120,
    buyers: 3120,
    status: 'graduated',
    creator: '0x3fA8…c21D',
    yourContribution: 500,
    yourTokens: 125_000,
    yourHolderRewards: 214.5,
    yourRebate: 61.0,
  },
  {
    id: 6,
    name: 'Nottingham',
    symbol: 'SHRF',
    glyph: '🛡️',
    tagline: 'Never made soft cap. The sheriff always loses here.',
    priceRbh: 0.01,
    tokensForSale: 10_000_000,
    tokensForLiquidity: 10_000_000,
    raised: 21_100,
    softCap: 60_000,
    endedAgo: '1w ago',
    liquidityBps: 5000,
    maxBuyPerWallet: 0,
    tradeFeeBps: 200,
    volume: 0,
    rewardsPaid: 0,
    holders: 0,
    buyers: 84,
    status: 'refunding',
    creator: '0xB00d…5e77',
    yourContribution: 140,
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

export function price(n: number): string {
  return n.toLocaleString('en-US', { maximumSignificantDigits: 3 })
}
