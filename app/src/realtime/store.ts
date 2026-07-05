import { supplyOf, type Launch } from '../data/launches'

/**
 * Realtime client. A single source of truth that streams every live value
 * (prices, market caps, trades, new coins, activity) to subscribers over
 * channels — the same shape a WebSocket client would have.
 *
 * There is no backend in this build, so `connect()` drives the stream from an
 * in-browser simulation. To go real, replace the body of `connect()` with:
 *
 *     this.ws = new WebSocket(WS_URL)
 *     this.ws.onmessage = (e) => this.apply(JSON.parse(e.data))
 *
 * and have the server push the same {market, trade, coin, activity} messages.
 * REST stays for user actions (createCoin, uploads, settings, auth).
 */

export interface Trade {
  id: number
  side: 'buy' | 'sell'
  who: string
  amount: string
  when: number
}

export interface Market {
  points: number[]
  price: number
  changePct: number
  trades: Trade[]
}

export interface Activity {
  id: number
  kind: 'launch' | 'buy' | 'sell' | 'claim'
  symbol: string
  name: string
  amount?: string
  href: string // Robinhood Chain explorer link
  when: number
}

/** Robinhood Chain block explorer (chain 4663). */
export const EXPLORER = 'https://explorer.mainnet.chain.robinhood.com'

const ADDRS = ['0x9f…2a1d', '0x3c…88fe', '0x71…9F02', '0xaa…04c1', '0x5d…4a0b', '0x08…b3c2', '0xdd…4f19', '0xc0…7b31']

function hash(str: string): number {
  let h = 0
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h || 1
}

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

type Channel = string

class RealtimeClient {
  private coins: Launch[] = []
  private market = new Map<number, Market>()
  private activity: Activity[] = []
  private listeners = new Map<Channel, Set<() => void>>()
  private timer: ReturnType<typeof setInterval> | null = null
  private started = false
  private tid = 0
  private aid = 0

  constructor() {
    for (const c of this.coins) this.market.set(c.id, this.seedMarket(c))
  }

  // ---- connection (WebSocket seam) -----------------------------------------

  connect() {
    if (this.started) return
    this.started = true
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibility)
    }
    this.start()
  }

  private onVisibility = () => {
    // pause the stream when the tab is hidden — cheap on CPU/battery
    if (typeof document !== 'undefined' && document.hidden) this.stop()
    else this.start()
  }

  private start() {
    if (!this.timer) this.timer = setInterval(() => this.tick(), 1000)
  }
  private stop() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  // ---- pub/sub -------------------------------------------------------------

  subscribe(channel: Channel, cb: () => void): () => void {
    let set = this.listeners.get(channel)
    if (!set) {
      set = new Set()
      this.listeners.set(channel, set)
    }
    set.add(cb)
    return () => set!.delete(cb)
  }

  private emit(channel: Channel) {
    this.listeners.get(channel)?.forEach((cb) => cb())
  }

  // ---- snapshots -----------------------------------------------------------

  getCoins(): Launch[] {
    return this.coins
  }
  getCoin(id: number): Launch | undefined {
    return this.coins.find((c) => c.id === id)
  }
  getMarket(id: number): Market {
    let m = this.market.get(id)
    if (!m) {
      const c = this.getCoin(id)
      m = this.seedMarket(c ?? { symbol: String(id), priceEth: 1e-9 } as Launch)
      this.market.set(id, m)
    }
    return m
  }
  getActivity(): Activity[] {
    return this.activity
  }

  // ---- the stream ----------------------------------------------------------

  private tick() {
    for (const c of this.coins) {
      const m = this.market.get(c.id)!
      const base = c.priceEth
      const last = m.points[m.points.length - 1]
      const drift = (Math.random() - 0.485) * base * 0.02
      const next = Math.max(base * 0.3, last + drift)
      const points = [...m.points.slice(1), next]
      const changePct = ((next - points[0]) / points[0]) * 100

      let trades = m.trades
      if (Math.random() < 0.55) {
        trades = [this.makeTrade(), ...m.trades].slice(0, 30)
      }

      this.market.set(c.id, { points, price: next, changePct, trades })
      this.emit(`market:${c.id}`)
    }

  }

  private makeTrade(): Trade {
    const side: Trade['side'] = Math.random() > 0.48 ? 'buy' : 'sell'
    const amt = Math.random() * 1.8 + 0.01
    return {
      id: ++this.tid,
      side,
      who: ADDRS[Math.floor(Math.random() * ADDRS.length)],
      amount: `${amt.toFixed(amt < 0.1 ? 3 : 2)} ETH`,
      when: Date.now(),
    }
  }

  private pushActivity(a: Omit<Activity, 'id' | 'when'>) {
    this.activity = [{ ...a, id: ++this.aid, when: Date.now() }, ...this.activity].slice(0, 40)
    this.emit('activity')
  }

  /** Notifications are only for the connected user's own actions, and link to
   *  the real transaction on the explorer. */
  notifyTrade(coin: Launch, side: 'buy' | 'sell', amount: string, txHash: string) {
    this.pushActivity({ kind: side, symbol: coin.symbol, name: coin.name, amount, href: `${EXPLORER}/tx/${txHash}` })
  }
  notifyClaim(coin: Launch, amount: string, txHash: string) {
    this.pushActivity({ kind: 'claim', symbol: coin.symbol, name: coin.name, amount, href: `${EXPLORER}/tx/${txHash}` })
  }
  notifyLaunch(name: string, symbol: string, txHash: string) {
    this.pushActivity({ kind: 'launch', symbol, name, href: `${EXPLORER}/tx/${txHash}` })
  }

  private seedMarket(c: Pick<Launch, 'symbol' | 'priceEth'>): Market {
    const points = seedSeries(c.symbol, c.priceEth, 90)
    const price = points[points.length - 1]
    const changePct = ((price - points[0]) / points[0]) * 100
    const trades = Array.from({ length: 6 }, () => this.makeTrade())
    return { points, price, changePct, trades }
  }

  private insertCoin(coin: Launch) {
    this.coins = [coin, ...this.coins]
    this.market.set(coin.id, this.seedMarket(coin))
    this.emit('board')
  }

  /** Load the live on-chain launches. Merges by id so existing coins keep
   *  their running chart/tape; new coins get a fresh market seeded at the
   *  real price. */
  loadCoins(list: Launch[]) {
    const byId = new Map(this.coins.map((c) => [c.id, c]))
    for (const c of list) {
      if (!this.market.has(c.id)) this.market.set(c.id, this.seedMarket(c))
      byId.set(c.id, { ...byId.get(c.id), ...c })
    }
    // newest first (list already sorted newest→oldest on-chain)
    const order = list.map((c) => c.id)
    this.coins = [...order.map((id) => byId.get(id)!), ...this.coins.filter((c) => !order.includes(c.id))]
    this.emit('board')
  }

  // ---- user action (REST-shaped) -------------------------------------------

  /** Create a coin. In production this is a REST POST; the server then pushes
   *  the new coin over the socket. Here we add it locally and broadcast. */
  createCoin(coin: Launch): Launch {
    this.insertCoin(coin)
    this.pushActivity({ kind: 'launch', symbol: coin.symbol, name: coin.name, href: `${EXPLORER}/address/${coin.tokenAddress}` })
    return coin
  }
}

export const realtime = new RealtimeClient()
export { supplyOf }
