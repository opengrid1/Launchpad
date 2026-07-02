import { useState } from 'react'
import { compact, eth, mcapUsd, price, rewardSplit, supplyOf, topHolders, usd, type Launch } from '../data/launches'
import { SplitMeter } from '../components/SplitMeter'
import { Monogram } from '../components/Monogram'
import { CandleChart } from '../components/LiveChart'
import { useLiveMarket, useLiveTrades } from '../components/useLiveMarket'

function CopyRow({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false)
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="eyebrow shrink-0">{label}</span>
      <button
        onClick={() => {
          navigator.clipboard?.writeText(value)
          setDone(true)
          setTimeout(() => setDone(false), 1200)
        }}
        className="tnum group inline-flex cursor-pointer items-center gap-1.5 text-[12px] text-ink transition-colors hover:text-emerald-strong"
        title="Copy"
      >
        {value}
        <span className="text-ink-3 group-hover:text-emerald-strong">{done ? '✓' : '⧉'}</span>
      </button>
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

const TF = ['5m', '1h', '24h', 'All']

export function LaunchDetail({ launch, onBack }: { launch: Launch; onBack: () => void }) {
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [amount, setAmount] = useState('')
  const [tf, setTf] = useState('24h')
  const [feed, setFeed] = useState<'trades' | 'holders'>('trades')

  const ticker = launch.symbol.replace(/[^A-Za-z0-9]/g, '').slice(0, 5).toUpperCase()
  const { price: live, points, changePct } = useLiveMarket(ticker, launch.priceEth, 90, 1000)
  const trades = useLiveTrades(ticker)
  const up = changePct >= 0
  const mcap = mcapUsd(live, launch)
  const { toHolders, toCreator } = rewardSplit(launch)
  const holders = topHolders(launch)
  const youAreCreator = launch.creator === '0x71b3…9F02'

  const amt = parseFloat(amount) || 0
  const out = side === 'buy' ? amt / live : amt * live

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
              {usd(mcap)} mcap · {price(live)} ETH
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="tnum text-[22px] font-bold leading-none text-ink">{price(live)} <span className="text-[12px] text-ink-3">ETH</span></p>
          <p className={`tnum mt-1.5 text-[13px] font-semibold ${up ? 'text-emerald-strong' : 'text-clay'}`}>
            {up ? '▲' : '▼'} {Math.abs(changePct).toFixed(2)}% · 24h
          </p>
        </div>
      </div>

      <div className="mt-5 grid items-start gap-5 lg:grid-cols-[1fr_336px]">
        {/* main: chart + stats + trades */}
        <div className="min-w-0">
          <div className="overflow-hidden rounded-2xl bg-surface ring-1 ring-line">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-2">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald live-dot" /> Live · single-sided v3
              </span>
              <div className="flex items-center gap-1">
                {TF.map((t) => (
                  <button
                    key={t}
                    onClick={() => setTf(t)}
                    className={`tnum cursor-pointer rounded-md px-2 py-1 text-[11px] transition ${tf === t ? 'bg-panel text-ink' : 'text-ink-3 hover:text-ink-2'}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div className="px-3 py-3">
              <CandleChart points={points} height={320} />
            </div>
            {/* stat strip under the chart */}
            <div className="grid grid-cols-2 divide-x divide-y divide-line border-t border-line sm:grid-cols-4 sm:divide-y-0">
              {[
                ['Market cap', usd(mcap)],
                ['24h', `${up ? '+' : ''}${changePct.toFixed(2)}%`],
                ['24h volume', `${compact(launch.volume)} ETH`],
                ['Holders', launch.holders.toLocaleString()],
              ].map(([k, v], i) => (
                <div key={k} className="px-4 py-2.5">
                  <p className="eyebrow">{k}</p>
                  <p className={`tnum mt-1 text-[14px] font-semibold ${i === 1 ? (up ? 'text-emerald-strong' : 'text-clay') : 'text-ink'}`}>{v}</p>
                </div>
              ))}
            </div>
          </div>

          {/* trades / holders */}
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
              <span className="ml-auto inline-flex items-center gap-1.5 pb-3 text-[11px] text-ink-3">
                {feed === 'trades' ? (
                  <>
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald live-dot" /> streaming
                  </>
                ) : (
                  `${launch.holders.toLocaleString()} total`
                )}
              </span>
            </div>

            {feed === 'trades' ? (
              <ul className="divide-y divide-line">
                {trades.map((t) => (
                  <li key={t.id} className="tnum flex items-center gap-3 px-4 py-2.5 text-[13px]">
                    <span className={`w-10 font-semibold ${t.side === 'buy' ? 'text-emerald-strong' : 'text-clay'}`}>
                      {t.side === 'buy' ? 'BUY' : 'SELL'}
                    </span>
                    <span className="text-ink-3">{t.who}</span>
                    <span className="ml-auto text-ink">{t.amount}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="divide-y divide-line">
                <li className="grid grid-cols-[1.5rem_1fr_auto_auto] gap-3 px-4 py-2">
                  <span className="eyebrow">#</span>
                  <span className="eyebrow">Wallet</span>
                  <span className="eyebrow text-right">Share</span>
                  <span className="eyebrow text-right">ETH earned</span>
                </li>
                {holders.map((h) => (
                  <li
                    key={h.rank}
                    className={`grid grid-cols-[1.5rem_1fr_auto_auto] items-center gap-3 px-4 py-2.5 text-[13px] ${h.you ? 'bg-emerald-tint/40' : ''}`}
                  >
                    <span className="tnum text-ink-3">{h.rank}</span>
                    <span className="tnum flex items-center gap-2 text-ink">
                      {h.address}
                      {h.you && <span className="rounded bg-emerald px-1.5 py-0.5 text-[10px] font-semibold text-paper">you</span>}
                    </span>
                    <span className="tnum text-right text-ink-2">{h.pct.toFixed(2)}%</span>
                    <span className="tnum text-right font-semibold text-emerald-strong">{eth(h.rewardsEth)}</span>
                  </li>
                ))}
              </ul>
            )}
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
              balance {side === 'buy' ? '3.42 ETH' : `${compact(launch.yourTokens)} ${ticker}`}
            </p>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {side === 'buy'
                ? ([['0.1', '0.1'], ['0.5', '0.5'], ['1', '1'], ['max', '3.42']] as const).map(([lbl, val]) => (
                    <button
                      key={lbl}
                      onClick={() => setAmount(val)}
                      className="tnum flex-1 cursor-pointer rounded-lg bg-panel py-1.5 text-[12px] text-ink-2 transition hover:text-ink"
                    >
                      {lbl}
                    </button>
                  ))
                : ([['25%', 0.25], ['50%', 0.5], ['100%', 1]] as const).map(([lbl, frac]) => (
                    <button
                      key={lbl}
                      onClick={() => setAmount(String(Math.floor(launch.yourTokens * frac)))}
                      className="tnum flex-1 cursor-pointer rounded-lg bg-panel py-1.5 text-[12px] text-ink-2 transition hover:text-ink"
                    >
                      {lbl}
                    </button>
                  ))}
            </div>

            <button
              disabled={!amt}
              className={`mt-4 w-full cursor-pointer rounded-full py-3 text-[14px] font-semibold text-paper transition disabled:cursor-not-allowed disabled:bg-panel disabled:text-ink-3 ${
                side === 'buy' ? 'bg-emerald hover:bg-emerald-strong' : 'bg-clay hover:opacity-90'
              }`}
            >
              {amt ? `${side === 'buy' ? 'Buy' : 'Sell'} ${ticker}` : 'Enter an amount'}
            </button>
            <div className="tnum mt-3 flex items-center justify-between text-[11px] text-ink-3">
              <span>≈ {side === 'buy' ? `${out ? compact(out) : '0'} ${ticker}` : `${eth(out)} ETH`}</span>
              <span>{launch.tradeFeeBps / 100}% tax · 50/50</span>
            </div>
          </div>

          {/* the split */}
          <div className="rounded-2xl bg-surface p-4 ring-1 ring-line">
            <div className="flex items-baseline justify-between">
              <h2 className="text-[13px] font-semibold text-ink">ETH tax rewards</h2>
              <span className="eyebrow">{launch.tradeFeeBps / 100}% · 50/50</span>
            </div>
            <div className="mt-3">
              <SplitMeter toHolders={toHolders} toCreator={toCreator} unit="ETH" compactMode />
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
              Half to holders, half to the creator{youAreCreator ? ' (you)' : ''}. Paid every trade.
            </p>
          </div>

          {/* token info */}
          <div className="rounded-2xl bg-surface p-4 ring-1 ring-line">
            <h2 className="text-[13px] font-semibold text-ink">Token info</h2>
            {launch.description && (
              <p className="mt-2 text-[12px] leading-relaxed text-ink-2">{launch.description}</p>
            )}
            <div className="mt-3 border-t border-line pt-1">
              <CopyRow label="Token" value={launch.tokenAddress} />
              <CopyRow label="Creator" value={launch.creator} />
              <InfoRow label="Supply" value={compact(supplyOf(launch))} />
              <InfoRow label="Dev buy" value={launch.devBuy ? `${eth(launch.devBuy)} ETH` : 'None'} />
              <InfoRow label="Pool" value="Uniswap v3 · single-sided" />
              <InfoRow label="Created" value={launch.createdAgo} />
              <InfoRow label="Chain" value="Robinhood · 4663" />
            </div>
          </div>
        </aside>
      </div>
    </main>
  )
}
