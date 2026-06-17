// Demo data for the Par UI. All figures are internally consistent:
//   hardCap   = priceEth * tokensForSale
//   raised   <= hardCap
//   softCap  <= hardCap
// so every number derived on screen is honest within the mock. These are
// fictional projects with plain descriptions, not hype copy.

export type Status = 'open' | 'scheduled' | 'funded' | 'refunding'

export interface Offering {
  id: number
  name: string
  ticker: string
  purpose: string // one plain sentence: what the token does
  priceEth: number // ETH per whole token — the par price, flat for the whole sale
  forSale: number // tokens offered to subscribers
  forLiquidity: number // tokens paired into the Uniswap pool on settlement
  raised: number // ETH subscribed so far
  softCap: number // ETH; below this the offering is cancelled and refunded
  liquidityBps: number // share of the raise paired into the pool (>= 5000)
  walletCap: number // ETH per address, 0 = none
  subscribers: number
  status: Status
  issuer: string
  opensIn?: string
  closesIn?: string
  closedAgo?: string
  // holdings of the connected demo wallet in this offering
  yourEth: number
  yourTokens: number
}

export const hardCapOf = (o: Offering) => o.priceEth * o.forSale
export const protocolFeeBps = 100 // 1%

export const OFFERINGS: Offering[] = [
  {
    id: 1,
    name: 'Meridian',
    ticker: 'MRD',
    purpose: 'Settlement layer for cross-rollup payments. Token meters sequencer bandwidth.',
    priceEth: 0.00009,
    forSale: 4_000_000,
    forLiquidity: 3_000_000,
    raised: 247.5,
    softCap: 180,
    liquidityBps: 7000,
    walletCap: 5,
    subscribers: 612,
    status: 'open',
    issuer: '0x3fA8…c21D',
    closesIn: '19h 40m',
    yourEth: 1.5,
    yourTokens: 16_666.67,
  },
  {
    id: 2,
    name: 'Tessellate',
    ticker: 'TESS',
    purpose: 'Options vaults that roll covered calls each epoch. Token directs strike selection.',
    priceEth: 0.00025,
    forSale: 2_000_000,
    forLiquidity: 1_400_000,
    raised: 138.2,
    softCap: 250,
    liquidityBps: 8000,
    walletCap: 10,
    subscribers: 96,
    status: 'open',
    issuer: '0x91b4…77Ae',
    closesIn: '2d 6h',
    yourEth: 0,
    yourTokens: 0,
  },
  {
    id: 3,
    name: 'Hearth',
    ticker: 'HRTH',
    purpose: 'Treasury tooling for small DAOs: streaming payroll, runway alerts, signer rotation.',
    priceEth: 0.00004,
    forSale: 8_000_000,
    forLiquidity: 8_000_000,
    raised: 41.1,
    softCap: 120,
    liquidityBps: 9000,
    walletCap: 0,
    subscribers: 73,
    status: 'open',
    issuer: '0xDd02…4f19',
    closesIn: '8h 12m',
    yourEth: 0,
    yourTokens: 0,
  },
  {
    id: 4,
    name: 'Ledgerline',
    ticker: 'LINE',
    purpose: 'Double-entry accounting primitive for onchain funds. Token gates the indexer.',
    priceEth: 0.0006,
    forSale: 1_500_000,
    forLiquidity: 1_000_000,
    raised: 0,
    softCap: 300,
    liquidityBps: 7500,
    walletCap: 8,
    subscribers: 0,
    status: 'scheduled',
    issuer: '0x77Cc…09bE',
    opensIn: '1d 6h',
    yourEth: 0,
    yourTokens: 0,
  },
  {
    id: 5,
    name: 'Cardinal',
    ticker: 'CARD',
    purpose: 'Reputation-weighted grants registry. One token, one ballot, quadratic tallies.',
    priceEth: 0.0002,
    forSale: 3_000_000,
    forLiquidity: 2_100_000,
    raised: 418.4,
    softCap: 250,
    liquidityBps: 7000,
    walletCap: 6,
    subscribers: 1_242,
    status: 'funded',
    issuer: '0x08aF…b3c2',
    closedAgo: '4d ago',
    yourEth: 2,
    yourTokens: 10_000,
  },
  {
    id: 6,
    name: 'Driftwood',
    ticker: 'DRFT',
    purpose: 'Escrow for physical goods sold as NFTs. Settles on confirmed delivery.',
    priceEth: 0.0005,
    forSale: 2_000_000,
    forLiquidity: 2_000_000,
    raised: 96.3,
    softCap: 350,
    liquidityBps: 6000,
    walletCap: 0,
    subscribers: 58,
    status: 'refunding',
    issuer: '0xB00d…5e77',
    closedAgo: '1w ago',
    yourEth: 0.8,
    yourTokens: 0,
  },
]

export const WALLET = { address: '0x3fA8…c21D', balanceEth: 12.84 }

const compactFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })

/** large token counts: 4_000_000 -> 4M, 16_667 -> 16.67K */
export function compact(n: number): string {
  if (n >= 1_000_000_000) return compactFmt.format(n / 1_000_000_000) + 'B'
  if (n >= 1_000_000) return compactFmt.format(n / 1_000_000) + 'M'
  if (n >= 1_000) return compactFmt.format(n / 1_000) + 'K'
  return compactFmt.format(n)
}

/** ETH amounts, precision scaled to magnitude */
export function eth(n: number): string {
  if (n === 0) return '0'
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (n >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return n.toLocaleString('en-US', { maximumSignificantDigits: 3 })
}

/** the per-token par price, intentionally small */
export function par(n: number): string {
  return n.toLocaleString('en-US', { maximumSignificantDigits: 3 })
}

/** exact integer-ish token counts with separators */
export function tokens(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

export function timeLabel(o: Offering): string {
  if (o.opensIn) return `opens in ${o.opensIn}`
  if (o.closesIn) return `closes in ${o.closesIn}`
  return `closed ${o.closedAgo}`
}
