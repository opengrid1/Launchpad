import { useEffect, useMemo, useState } from 'react'
import { compact, ETH_USD, eth, mcapUsd, price, supplyOf, topHolders, usd, type Launch } from '../data/launches'
import { Monogram } from '../components/Monogram'
import { TVChart } from '../components/TVChart'
import { useMarket } from '../realtime/hooks'
import { realtime } from '../realtime/store'
import * as loxley from '../loxley'
import type { Wallet } from '../web3/useWallet'

/** Compact "2m ago" style relative time. */
function relTime(ms: number): string {
  if (!ms) return ''
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M10.5 5.5 V3.5 A1.5 1.5 0 0 0 9 2 H3.5 A1.5 1.5 0 0 0 2 3.5 V9 A1.5 1.5 0 0 0 3.5 10.5 H5.5" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false)
  const display = value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="eyebrow shrink-0">{label}</span>
      <button
        onClick={() => {
          navigator.clipboard?.writeText(value)
          setDone(true)
          setTimeout(() => setDone(false), 1200)
        }}
        className={`tnum inline-flex max-w-full shrink cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[12px] ring-1 transition ${
          done ? 'bg-emerald-tint text-emerald-strong ring-emerald/40' : 'bg-panel text-ink ring-line hover:ring-line-2'
        }`}
        title={`Copy ${value}`}
      >
        <span className="truncate">{display}</span>
        <span className={`shrink-0 ${done ? 'text-emerald-strong' : 'text-ink-3'}`}>{done ? '✓' : <CopyIcon />}</span>
      </button>
    </div>
  )
}

function SocialLinks({ socials }: { socials: NonNullable<Launch['socials']> }) {
  const items: { key: string; href?: string; label: string; icon: React.ReactNode }[] = [
    {
      key: 'x',
      href: socials.x,
      label: 'X',
      icon: (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" /></svg>
      ),
    },
    {
      key: 'tg',
      href: socials.telegram,
      label: 'Telegram',
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0Zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635Z" /></svg>
      ),
    },
    {
      key: 'web',
      href: socials.website,
      label: 'Website',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden><circle cx="12" cy="12" r="9.25" stroke="currentColor" strokeWidth="1.6" /><path d="M2.75 12h18.5M12 2.75c2.4 2.3 3.75 5.7 3.75 9.25S14.4 18.95 12 21.25c-2.4-2.3-3.75-5.7-3.75-9.25S9.6 5.05 12 2.75Z" stroke="currentColor" strokeWidth="1.6" /></svg>
      ),
    },
  ].filter((i) => i.href)

  if (items.length === 0) return null
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {items.map((i) => (
        <a
          key={i.key}
          href={i.href}
          target="_blank"
          rel="noopener noreferrer"
          title={i.label}
          aria-label={i.label}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-panel text-ink-2 ring-1 ring-line transition hover:text-ink hover:ring-line-2"
        >
          {i.icon}
        </a>
      ))}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="eyebrow shrink-0">{label}</span>
      <span className="tnum text-[12px] text-ink">{value}</span>
    </div>
  )
}

// chart axis / crosshair USD formatter — keeps ~4 significant figures so
// nearby values (e.g. $2.03K vs $2.04K) don't all collapse to "$2K".
function usdTick(v: number): string {
  if (v >= 1e9) return '$' + (v / 1e9).toLocaleString('en-US', { maximumSignificantDigits: 4 }) + 'B'
  if (v >= 1e6) return '$' + (v / 1e6).toLocaleString('en-US', { maximumSignificantDigits: 4 }) + 'M'
  if (v >= 1e3) return '$' + (v / 1e3).toLocaleString('en-US', { maximumSignificantDigits: 4 }) + 'K'
  return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

// each timeframe = a lookback window over the real price history
const TF: { label: string; secs: number }[] = [
  { label: '1h', secs: 3600 },
  { label: '6h', secs: 21600 },
  { label: '24h', secs: 86400 },
  { label: 'All', secs: 0 },
]

export function LaunchDetail({ launch, onBack, wallet }: { launch: Launch; onBack: () => void; wallet: Wallet }) {
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [amount, setAmount] = useState('')
  const [tf, setTf] = useState('1h')
  const [feed, setFeed] = useState<'trades' | 'holders'>('trades')
  const [claiming, setClaiming] = useState(false)
  const [claimStage, setClaimStage] = useState<'collect' | 'claim' | null>(null)
  const [claimErr, setClaimErr] = useState<string | null>(null)
  const [slippage, setSlippage] = useState(1)
  const [trading, setTrading] = useState(false)
  const [tradeErr, setTradeErr] = useState<string | null>(null)
  const [tradeOk, setTradeOk] = useState(false)
  const [tradeHash, setTradeHash] = useState('')
  const [ethBal, setEthBal] = useState(0)
  const [tokBal, setTokBal] = useState(0)
  const [livePrice, setLivePrice] = useState(0)
  const [quotedOut, setQuotedOut] = useState<number | null>(null)
  const [claimableHolder, setClaimableHolder] = useState(0)
  const [creatorFees, setCreatorFees] = useState(0)
  const [activity, setActivity] = useState<loxley.PoolActivity | null>(null)
  const tfSecs = TF.find((t) => t.label === tf)?.secs ?? 0

  const ticker = launch.symbol.replace(/[^A-Za-z0-9]/g, '').slice(0, 5).toUpperCase()
  const { price: live, points, changePct: simChange, trades: simTrades } = useMarket(launch.id)
  const priceEthNow = livePrice || launch.priceEth // live-polled ETH per token
  const mcap = mcapUsd(priceEthNow, launch) // real price → USD market cap
  const mcapMult = supplyOf(launch) * ETH_USD // price(ETH) -> market cap (USD)
  const holderRows =
    activity && activity.holderList.length
      ? activity.holderList.map((h, i) => ({ rank: i + 1, address: h.address, pct: h.pct, earnedEth: h.earnedEth, you: h.isYou }))
      : topHolders(launch).map((h) => ({ rank: h.rank, address: h.address, pct: h.pct, earnedEth: h.rewardsEth, you: h.you }))
  const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
  const youAreCreator =
    !!wallet.account &&
    (launch.creatorAddress
      ? launch.creatorAddress.toLowerCase() === wallet.account.toLowerCase()
      : launch.creator.toLowerCase() === short(wallet.account).toLowerCase())

  // pull the connected wallet's real claimable ETH (holder dividends + creator fees)
  const isRealToken = launch.tokenAddress.startsWith('0x') && launch.tokenAddress.length === 42
  useEffect(() => {
    let alive = true
    setClaimableHolder(0)
    setCreatorFees(0)
    if (wallet.account && isRealToken) {
      loxley.claimableEth(launch.tokenAddress, wallet.account).then((v) => { if (alive) setClaimableHolder(v) }).catch(() => {})
      loxley.creatorFees(launch.tokenAddress).then((v) => { if (alive) setCreatorFees(v) }).catch(() => {})
    }
    return () => { alive = false }
  }, [wallet.account, launch.tokenAddress, isRealToken])

  // real on-chain activity, polled live: price series, trade tape, volume,
  // change, holders — reconstructed from the pool's v4 Swap + Transfer events.
  // Re-fetched on an interval so trades by anyone show up without a refresh.
  useEffect(() => {
    if (!isRealToken) { setActivity(null); return }
    let alive = true
    setActivity(null)
    const poll = () => {
      loxley.fetchPoolActivity(launch.tokenAddress, supplyOf(launch), ETH_USD, wallet.account).then((a) => { if (alive) setActivity(a) }).catch(() => {})
      loxley.priceEthOf(launch.tokenAddress).then((p) => { if (alive && p > 0) setLivePrice(p) }).catch(() => {})
    }
    poll()
    const id = setInterval(() => { if (!document.hidden) poll() }, 12000)
    return () => { alive = false; clearInterval(id) }
  }, [launch.tokenAddress, isRealToken, wallet.account])

  // connected wallet's real balances (ETH + this token)
  const refreshBalances = () => {
    if (!wallet.account || !isRealToken) return
    loxley.ethBalance(wallet.account).then(setEthBal).catch(() => {})
    loxley.tokenBalance(launch.tokenAddress, wallet.account).then(setTokBal).catch(() => {})
  }
  useEffect(() => {
    setEthBal(0)
    setTokBal(0)
    refreshBalances()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.account, launch.tokenAddress, isRealToken])

  // prefer real data; fall back to the live feed only until it loads
  const chartPoints = points.map((p) => p * mcapMult)
  // real candles, re-bucketed for the selected lookback window
  const realCandles = useMemo(() => {
    const pts = activity?.pricePoints
    if (!pts || pts.length === 0) return undefined
    const now = Math.floor(Date.now() / 1000)
    let windowed = tfSecs > 0 ? pts.filter((p) => p.t >= now - tfSecs) : pts
    if (windowed.length < 2) windowed = pts // not enough in-window → show full history
    return loxley.buildCandles(windowed, now)
  }, [activity, tfSecs])
  const changePct = activity ? activity.changePct : simChange
  const up = changePct >= 0
  const volumeEth = activity ? activity.volumeEth : launch.volume
  const volumeUsd = volumeEth * ETH_USD
  const holderCount = activity ? activity.holders : launch.holders
  const trades = activity ? activity.trades : simTrades

  const creatorEarnings = youAreCreator ? creatorFees : 0
  const claimable = claimableHolder + creatorEarnings

  async function doClaim() {
    if (claiming || !isRealToken) return
    setClaimErr(null)
    setClaiming(true)
    try {
      let signer = wallet.signer
      if (!signer) signer = (await loxley.connectWallet()).signer
      const acct = wallet.account ?? (await signer.getAddress())
      // 1. sync: pull the pool's LP fees into the holder/creator reward pools
      setClaimStage('collect')
      await loxley.collectFees(signer, launch.tokenAddress).catch(() => {})
      // 2. re-read what's now claimable
      const [hold, cf] = await Promise.all([
        loxley.claimableEth(launch.tokenAddress, acct).catch(() => 0),
        loxley.creatorFees(launch.tokenAddress).catch(() => 0),
      ])
      // 3. claim whatever is owed
      setClaimStage('claim')
      let did = false
      let hash = ''
      if (hold > 0) { hash = await loxley.claimEthDividends(signer, launch.tokenAddress); did = true }
      if (youAreCreator && cf > 0) { hash = await loxley.claimCreatorFees(signer, launch.tokenAddress); did = true }
      if (did) realtime.notifyClaim(launch, `${eth(hold + (youAreCreator ? cf : 0))} ETH`, hash)
      if (!did) setClaimErr('No rewards to claim yet — they accrue from trading fees.')
      setClaimableHolder(await loxley.claimableEth(launch.tokenAddress, acct).catch(() => 0))
      setCreatorFees(await loxley.creatorFees(launch.tokenAddress).catch(() => 0))
      refreshBalances()
    } catch (e) {
      const m = e instanceof Error ? e.message : 'Claim failed'
      setClaimErr(m.length > 140 ? m.slice(0, 140) + '…' : m)
    } finally {
      setClaiming(false)
      setClaimStage(null)
    }
  }

  const amt = parseFloat(amount) || 0
  const px = priceEthNow || live // real ETH-per-token
  const spotOut = side === 'buy' ? amt / px : amt * px

  // real quote from the v4 Quoter (accounts for price impact), debounced
  useEffect(() => {
    if (!isRealToken || !amt) { setQuotedOut(null); return }
    let alive = true
    const t = setTimeout(() => {
      const q = side === 'buy' ? loxley.quoteBuy(launch.tokenAddress, amount) : loxley.quoteSell(launch.tokenAddress, amount)
      q.then((v) => { if (alive) setQuotedOut(v) }).catch(() => { if (alive) setQuotedOut(null) })
    }, 400)
    return () => { alive = false; clearTimeout(t) }
  }, [amount, side, launch.tokenAddress, isRealToken, amt])

  const out = quotedOut ?? spotOut
  const priceImpact = quotedOut != null && spotOut > 0 ? Math.max(0, 1 - quotedOut / spotOut) : 0

  async function doTrade() {
    if (!amt || trading) return
    if (!isRealToken) {
      setTradeErr('This is a demo coin — trading is only live for on-chain tokens.')
      return
    }
    setTradeErr(null)
    setTradeOk(false)
    setTrading(true)
    try {
      let signer = wallet.signer
      if (!signer) signer = (await loxley.connectWallet()).signer
      const hash =
        side === 'buy'
          ? await loxley.buy(signer, launch.tokenAddress, amount, slippage)
          : await loxley.sell(signer, launch.tokenAddress, amount, slippage)
      setTradeOk(true)
      setTradeHash(hash)
      realtime.notifyTrade(launch, side, `${eth(side === 'buy' ? amt : out)} ETH`, hash)
      setAmount('')
      // refresh the tape / price / balances shortly after
      loxley.fetchPoolActivity(launch.tokenAddress, supplyOf(launch), ETH_USD, wallet.account).then(setActivity).catch(() => {})
      refreshBalances()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Trade failed'
      setTradeErr(msg.length > 140 ? msg.slice(0, 140) + '…' : msg)
    } finally {
      setTrading(false)
    }
  }

  return (
    <main className="rise-in py-5">
      <button onClick={onBack} className="text-[13px] text-ink-2 transition-colors hover:text-ink">
        ← All coins
      </button>

      {/* market header */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Monogram symbol={launch.symbol} glyph={launch.glyph} image={launch.image} size="lg" />
          <div>
            <h1 className="font-display text-[24px] font-extrabold leading-none tracking-tight">
              {launch.name} <span className="text-[14px] font-semibold text-ink-3">${ticker}</span>
            </h1>
            <p className="tnum mt-1.5 text-[12px] text-ink-3">
              {usd(mcap)} mcap · {price(priceEthNow)} ETH
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="tnum text-[22px] font-bold leading-none text-ink">{price(priceEthNow)} <span className="text-[12px] text-ink-3">ETH</span></p>
          <p className={`tnum mt-1.5 text-[13px] font-semibold ${up ? 'text-emerald-strong' : 'text-clay'}`}>
            {up ? '▲' : '▼'} {Math.abs(changePct).toFixed(2)}%
          </p>
        </div>
      </div>

      <div className="mt-5 grid items-start gap-5 lg:grid-cols-[1fr_336px]">
        {/* main: chart + stats + trades */}
        <div className="min-w-0">
          <div className="overflow-hidden rounded-2xl bg-surface ring-1 ring-line">
            <div className="flex items-center justify-end border-b border-line px-4 py-2.5">
              <div className="flex items-center gap-1">
                {TF.map((t) => (
                  <button
                    key={t.label}
                    onClick={() => setTf(t.label)}
                    className={`tnum cursor-pointer rounded-md px-2 py-1 text-[11px] transition ${tf === t.label ? 'bg-panel text-ink' : 'text-ink-3 hover:text-ink-2'}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="px-2 py-2">
              {isRealToken && !activity ? (
                <div className="flex items-center justify-center text-[12px] text-ink-3" style={{ height: 320 }}>
                  Loading price history…
                </div>
              ) : (
                <TVChart points={chartPoints} candles={realCandles} height={320} variant="candle" formatter={usdTick} />
              )}
            </div>
            {/* stat strip under the chart */}
            <div className="grid grid-cols-2 divide-x divide-y divide-line border-t border-line sm:grid-cols-4 sm:divide-y-0">
              {[
                ['Market cap', usd(mcap)],
                ['Change', `${up ? '+' : ''}${changePct.toFixed(2)}%`],
                ['Volume', usd(volumeUsd)],
                ['Holders', holderCount.toLocaleString()],
              ].map(([k, v], i) => (
                <div key={k} className="px-4 py-2.5">
                  <p className="eyebrow">{k}</p>
                  <p className={`tnum mt-1 text-[14px] font-semibold ${i === 1 ? (up ? 'text-emerald-strong' : 'text-clay') : 'text-ink'}`}>{v}</p>
                </div>
              ))}
            </div>
          </div>

        </div>

        {/* right rail: trade + split + token info */}
        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          {/* buy / sell */}
          <div className="rounded-2xl bg-surface p-4 ring-1 ring-line">
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-panel p-1">
              {(['buy', 'sell'] as const).map((sd) => (
                <button
                  key={sd}
                  onClick={() => setSide(sd)}
                  className={`cursor-pointer rounded-lg py-2 text-[13px] font-semibold capitalize transition ${
                    side === sd ? (sd === 'buy' ? 'bg-emerald text-paper' : 'bg-clay text-paper') : 'text-ink-2 hover:text-ink'
                  }`}
                >
                  {sd}
                </button>
              ))}
            </div>

            <div className="mt-3 flex items-center gap-2 border-b border-line-2 pb-2 focus-within:border-emerald/60">
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.0"
                inputMode="decimal"
                className="tnum w-full bg-transparent text-[26px] font-semibold text-ink outline-none placeholder:text-ink-3/40"
              />
              <span className="tnum shrink-0 text-[13px] font-semibold text-ink-2">{side === 'buy' ? 'ETH' : ticker}</span>
            </div>
            <p className="tnum mt-1.5 text-[11px] text-ink-3">
              balance {side === 'buy' ? `${eth(ethBal)} ETH` : `${compact(tokBal)} ${ticker}`}
            </p>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {side === 'buy'
                ? ([['0.01', 0.01], ['0.1', 0.1], ['0.5', 0.5], ['max', Math.max(0, ethBal - 0.001)]] as const).map(([lbl, val]) => (
                    <button
                      key={lbl}
                      onClick={() => setAmount(String(val))}
                      className="tnum flex-1 cursor-pointer rounded-lg bg-panel py-1.5 text-[12px] text-ink-2 transition hover:text-ink"
                    >
                      {lbl}
                    </button>
                  ))
                : ([['25%', 0.25], ['50%', 0.5], ['100%', 1]] as const).map(([lbl, frac]) => (
                    <button
                      key={lbl}
                      onClick={() => setAmount(String(Math.floor(tokBal * frac)))}
                      className="tnum flex-1 cursor-pointer rounded-lg bg-panel py-1.5 text-[12px] text-ink-2 transition hover:text-ink"
                    >
                      {lbl}
                    </button>
                  ))}
            </div>

            {/* slippage */}
            <div className="mt-3 flex items-center justify-between gap-2">
              <span className="text-[11px] text-ink-3">Max slippage</span>
              <div className="flex items-center gap-1">
                {[0.5, 1, 3].map((s) => (
                  <button
                    key={s}
                    onClick={() => setSlippage(s)}
                    className={`tnum cursor-pointer rounded-md px-2 py-1 text-[11px] transition ${
                      slippage === s ? 'bg-panel text-ink ring-1 ring-line-2' : 'text-ink-3 hover:text-ink-2'
                    }`}
                  >
                    {s}%
                  </button>
                ))}
                <input
                  value={slippage}
                  onChange={(e) => setSlippage(Math.min(50, Math.max(0.1, parseFloat(e.target.value) || 1)))}
                  inputMode="decimal"
                  className="tnum w-12 rounded-md bg-panel px-2 py-1 text-right text-[11px] text-ink outline-none ring-1 ring-line focus:ring-emerald/50"
                />
              </div>
            </div>

            <button
              onClick={doTrade}
              disabled={!amt || trading}
              className={`mt-3 w-full cursor-pointer rounded-full py-3 text-[14px] font-semibold text-paper transition disabled:cursor-not-allowed disabled:bg-panel disabled:text-ink-3 ${
                side === 'buy' ? 'bg-emerald hover:bg-emerald-strong' : 'bg-clay hover:opacity-90'
              }`}
            >
              {trading
                ? side === 'buy' ? 'Buying…' : 'Selling…'
                : !amt ? 'Enter an amount'
                : !wallet.account ? `Connect & ${side}`
                : `${side === 'buy' ? 'Buy' : 'Sell'} ${ticker}`}
            </button>
            {tradeErr && <p className="mt-2 break-words text-[11px] text-clay">{tradeErr}</p>}
            {tradeOk && (
              <p className="mt-2 text-[11px] text-emerald-strong">
                Trade submitted ✓{' '}
                {tradeHash && (
                  <a href={loxley.txUrl(tradeHash)} target="_blank" rel="noopener noreferrer" className="underline hover:text-emerald">
                    view tx ↗
                  </a>
                )}
              </p>
            )}
            {amt > 0 && priceImpact >= 0.05 && (
              <p className={`mt-2 text-[11px] ${priceImpact >= 0.15 ? 'text-clay' : 'text-gold'}`}>
                ⚠ High price impact: {(priceImpact * 100).toFixed(1)}% — you may want a higher slippage.
              </p>
            )}
            <div className="tnum mt-3 flex items-center justify-between text-[11px] text-ink-3">
              <span>≈ {side === 'buy' ? `${out ? compact(out) : '0'} ${ticker}` : `${eth(out)} ETH`}</span>
              <span>{launch.tradeFeeBps / 100}% tax</span>
            </div>
          </div>

          {/* your rewards */}
          <div className="rounded-2xl bg-surface p-4 ring-1 ring-line">
            <h2 className="text-[13px] font-semibold text-ink">Your rewards</h2>
            <div className="mt-3 space-y-2">
              <div className="tnum flex items-baseline justify-between text-[13px]">
                <span className="text-ink-2">As a holder</span>
                <span className="text-ink">{eth(claimableHolder)} ETH</span>
              </div>
              {youAreCreator && (
                <div className="tnum flex items-baseline justify-between text-[13px]">
                  <span className="text-ink-2">As the creator</span>
                  <span className="text-ink">{eth(creatorEarnings)} ETH</span>
                </div>
              )}
              <div className="tnum flex items-baseline justify-between border-t border-line pt-2 text-[13px]">
                <span className="font-semibold text-ink">Claimable</span>
                <span className="font-semibold text-emerald-strong">{eth(claimable)} ETH</span>
              </div>
            </div>
            <button
              onClick={doClaim}
              disabled={claiming || !isRealToken}
              className="mt-4 w-full cursor-pointer rounded-full bg-emerald py-2.5 text-[14px] font-semibold text-paper transition hover:bg-emerald-strong disabled:cursor-not-allowed disabled:bg-panel disabled:text-ink-3"
            >
              {claiming
                ? claimStage === 'collect' ? 'Collecting fees…' : 'Claiming…'
                : !wallet.account ? 'Connect to claim'
                : claimable > 0 ? `Claim ${eth(claimable)} ETH`
                : 'Collect & claim'}
            </button>
            {claimErr && <p className="mt-2 break-words text-[11px] text-clay">{claimErr}</p>}
            {claimable <= 0 && !claimErr && (
              <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
                Rewards accrue from every trade's fees. Tap collect to pull them from the pool, then claim.
              </p>
            )}
          </div>

          {/* token info */}
          <div className="rounded-2xl bg-surface p-4 ring-1 ring-line">
            <h2 className="text-[13px] font-semibold text-ink">Token info</h2>
            {launch.description && (
              <p className="mt-2 text-[12px] leading-relaxed text-ink-2">{launch.description}</p>
            )}
            {launch.socials && <SocialLinks socials={launch.socials} />}
            <div className="mt-3 border-t border-line pt-1">
              <CopyRow label="Token" value={launch.tokenAddress} />
              <CopyRow label="Creator" value={launch.creator} />
              <InfoRow label="Supply" value={compact(supplyOf(launch))} />
              <InfoRow label="Dev buy" value={launch.devBuy ? `${eth(launch.devBuy)} ETH` : 'None'} />
              <InfoRow label="Created" value={launch.createdAgo} />
            </div>
          </div>
        </aside>
      </div>

      {/* trades / holders — full width at the bottom */}
      <div className="mt-5 overflow-hidden rounded-2xl bg-surface ring-1 ring-line">
        <div className="flex items-center gap-5 border-b border-line px-4 pt-3">
          {(['trades', 'holders'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setFeed(t)}
              className={`cursor-pointer pb-3 text-[13px] font-medium transition-colors ${feed === t ? 'text-ink' : 'text-ink-3 hover:text-ink-2'}`}
            >
              {t === 'trades' ? 'Live trades' : 'Holders'}
              {feed === t && <span className="mt-2 block h-0.5 rounded-full bg-emerald" />}
            </button>
          ))}
          <span className="ml-auto pb-3 text-[11px] text-ink-3">
            {feed === 'trades' ? `${trades.length} trades` : `${holderCount.toLocaleString()} total`}
          </span>
        </div>

        {feed === 'trades' ? (
          trades.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-ink-3">No trades yet — be the first.</p>
          ) : (
            <ul className="divide-y divide-line">
              {trades.map((t) => (
                <li key={t.id} className="tnum flex items-center gap-3 px-4 py-2.5 text-[13px]">
                  <span className={`w-10 shrink-0 font-semibold ${t.side === 'buy' ? 'text-emerald-strong' : 'text-clay'}`}>
                    {t.side === 'buy' ? 'BUY' : 'SELL'}
                  </span>
                  <a
                    href={`${loxley.CHAIN.explorer}/address/${t.who}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="truncate text-ink-3 transition hover:text-ink hover:underline"
                  >
                    {t.who}
                  </a>
                  <span className="ml-auto shrink-0 text-ink">{t.amount}</span>
                  {t.when > 0 && <span className="w-10 shrink-0 text-right text-[11px] text-ink-3">{relTime(t.when)}</span>}
                </li>
              ))}
            </ul>
          )
        ) : (
          <ul className="divide-y divide-line">
            <li className="grid grid-cols-[1.5rem_1fr_auto_auto] gap-3 px-4 py-2">
              <span className="eyebrow">#</span>
              <span className="eyebrow">Wallet</span>
              <span className="eyebrow text-right">Share</span>
              <span className="eyebrow text-right">ETH earned</span>
            </li>
            {holderRows.length === 0 ? (
              <li className="px-4 py-8 text-center text-[13px] text-ink-3">No holders yet.</li>
            ) : (
              holderRows.map((h) => (
                <li
                  key={h.rank}
                  className={`grid grid-cols-[1.5rem_1fr_auto_auto] items-center gap-3 px-4 py-2.5 text-[13px] ${h.you ? 'bg-emerald-tint/40' : ''}`}
                >
                  <span className="tnum text-ink-3">{h.rank}</span>
                  <span className="tnum flex min-w-0 items-center gap-2 text-ink">
                    <span className="truncate">{h.address}</span>
                    {h.you && <span className="shrink-0 rounded bg-emerald px-1.5 py-0.5 text-[10px] font-semibold text-paper">you</span>}
                  </span>
                  <span className="tnum text-right text-ink-2">{h.pct.toFixed(2)}%</span>
                  <span className="tnum text-right font-semibold text-emerald-strong">{eth(h.earnedEth)}</span>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </main>
  )
}
