import { useState } from 'react'
import { compact, price, rewardSplit, type Launch } from '../data/launches'
import { SplitMeter } from '../components/SplitMeter'
import { Monogram } from '../components/Monogram'
import { LiveChart } from '../components/LiveChart'
import { useLiveMarket, useLiveTrades } from '../components/useLiveMarket'

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <div className="min-w-[110px] flex-1">
      <p className="eyebrow">{label}</p>
      <p className={`tnum mt-1.5 text-[16px] font-semibold ${tone === 'up' ? 'text-emerald-strong' : tone === 'down' ? 'text-clay' : 'text-ink'}`}>{value}</p>
    </div>
  )
}

const TF = ['5m', '1h', '24h', 'All']

export function LaunchDetail({ launch, onBack }: { launch: Launch; onBack: () => void }) {
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [amount, setAmount] = useState('')
  const [tf, setTf] = useState('24h')

  const ticker = launch.symbol.replace(/[^A-Za-z0-9]/g, '').slice(0, 5).toUpperCase()
  const supply = launch.tokensForSale + launch.tokensForLiquidity
  const { price: live, points, changePct } = useLiveMarket(ticker, launch.priceRbh, 72, 1000)
  const trades = useLiveTrades(ticker)
  const up = changePct >= 0
  const mcap = live * supply
  const { toHolders, toTraders } = rewardSplit(launch)

  const amt = parseFloat(amount) || 0
  const out = side === 'buy' ? amt / live : amt * live

  return (
    <main className="rise-in py-6">
      <button onClick={onBack} className="text-[13px] text-ink-2 transition-colors hover:text-ink">
        ← All coins
      </button>

      {/* market header */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Monogram symbol={launch.symbol} size="lg" />
          <div>
            <h1 className="font-display text-[26px] font-extrabold leading-none tracking-tight">
              {launch.name} <span className="text-[15px] font-semibold text-ink-3">${ticker}</span>
            </h1>
            <p className="mt-1.5 text-[12px] text-ink-2">{launch.tagline}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="tnum text-[26px] font-bold leading-none text-ink">{price(live)} <span className="text-[13px] text-ink-3">RBH</span></p>
          <p className={`tnum mt-1.5 text-[13px] font-semibold ${up ? 'text-emerald-strong' : 'text-clay'}`}>
            {up ? '▲' : '▼'} {Math.abs(changePct).toFixed(2)}% · 24h
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
        {/* chart + info */}
        <div>
          <div className="overflow-hidden rounded-2xl bg-surface ring-1 ring-line">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-2">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald live-dot" /> Live
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
            <div className="px-1 pb-1 pt-3">
              <LiveChart points={points} up={up} height={260} />
            </div>
          </div>

          {/* market stats */}
          <div className="mt-5 flex flex-wrap gap-y-5 rounded-2xl bg-surface px-5 py-4 ring-1 ring-line">
            <Figure label="Market cap" value={`${compact(mcap)} RBH`} />
            <Figure label="24h change" value={`${up ? '+' : ''}${changePct.toFixed(2)}%`} tone={up ? 'up' : 'down'} />
            <Figure label="24h volume" value={`${compact(launch.volume)} RBH`} />
            <Figure label="Holders" value={launch.holders ? launch.holders.toLocaleString() : '—'} />
          </div>

          {/* the split */}
          <div className="mt-5 rounded-2xl bg-surface p-5 ring-1 ring-line">
            <h2 className="font-display text-[19px] font-bold tracking-tight">Where the fees go</h2>
            <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-ink-2">
              Every buy and sell pays a {launch.tradeFeeBps / 100}% fee. It splits in half the same block:
              half to everyone holding {ticker}, half rebated to the trader who made the swap.
            </p>
            <div className="mt-5 max-w-xl">
              <SplitMeter toHolders={toHolders} toTraders={toTraders} />
            </div>
          </div>

          {/* how it works */}
          <div className="mt-5 rounded-2xl bg-surface p-5 ring-1 ring-line">
            <h2 className="font-display text-[19px] font-bold tracking-tight">How {ticker} works</h2>
            <ol className="mt-4 space-y-4">
              {[
                `${launch.name} trades the moment it launches. Buy or sell any time at the live price.`,
                `Every trade pays a ${launch.tradeFeeBps / 100}% fee. No fee on holding.`,
                `That fee splits 50/50 in-block: half to holders, half rebated to the trader.`,
                `Liquidity is locked and the LP is burned, so it can't be pulled.`,
              ].map((t, i) => (
                <li key={i} className="flex gap-4 text-[13px] leading-relaxed text-ink-2">
                  <span className="font-display shrink-0 text-[17px] font-bold leading-none text-emerald-strong">{i + 1}</span>
                  <span className="pt-0.5">{t}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* trade rail */}
        <aside className="space-y-5 lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl bg-surface p-4 ring-1 ring-line">
            {/* buy / sell */}
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-panel p-1">
              {(['buy', 'sell'] as const).map((sd) => (
                <button
                  key={sd}
                  onClick={() => setSide(sd)}
                  className={`cursor-pointer rounded-lg py-2 text-[13px] font-semibold capitalize transition ${
                    side === sd
                      ? sd === 'buy' ? 'bg-emerald text-paper' : 'bg-clay text-paper'
                      : 'text-ink-2 hover:text-ink'
                  }`}
                >
                  {sd}
                </button>
              ))}
            </div>

            <label className="mt-4 block rounded-xl bg-panel p-3">
              <span className="flex items-baseline justify-between">
                <span className="eyebrow">You pay</span>
                <span className="tnum text-[11px] text-ink-3">
                  {side === 'buy' ? 'balance 1,204 RBH' : `balance ${compact(launch.yourTokens)} ${ticker}`}
                </span>
              </span>
              <span className="mt-2 flex items-center gap-2">
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.0"
                  inputMode="decimal"
                  className="tnum w-full bg-transparent text-[24px] font-semibold text-ink outline-none placeholder:text-ink-3/40"
                />
                <span className="tnum shrink-0 rounded-md bg-surface px-2 py-1 text-[12px] font-semibold text-ink-2">
                  {side === 'buy' ? 'RBH' : ticker}
                </span>
              </span>
            </label>

            <div className="mt-2 flex items-center justify-center text-ink-3">↓</div>

            <div className="rounded-xl bg-panel p-3">
              <span className="eyebrow">You receive</span>
              <p className="tnum mt-1.5 text-[22px] font-semibold text-ink">
                {out ? compact(out) : '0'} <span className="text-[13px] text-ink-3">{side === 'buy' ? ticker : 'RBH'}</span>
              </p>
            </div>

            <button
              disabled={!amt}
              className={`mt-4 w-full cursor-pointer rounded-full py-3 text-[14px] font-semibold text-paper transition disabled:cursor-not-allowed disabled:bg-panel disabled:text-ink-3 ${
                side === 'buy' ? 'bg-emerald hover:bg-emerald-strong' : 'bg-clay hover:opacity-90'
              }`}
            >
              {amt ? `${side === 'buy' ? 'Buy' : 'Sell'} ${ticker}` : 'Enter an amount'}
            </button>
            <p className="tnum mt-3 flex items-center justify-between text-[11px] text-ink-3">
              <span>Price {price(live)} RBH</span>
              <span>Fee {launch.tradeFeeBps / 100}% · 50/50</span>
            </p>
          </div>

          {/* live trades */}
          <div className="rounded-2xl bg-surface p-4 ring-1 ring-line">
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-semibold text-ink">Live trades</h3>
              <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-3">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald live-dot" /> streaming
              </span>
            </div>
            <ul className="mt-3 space-y-2">
              {trades.map((t) => (
                <li key={t.id} className="tnum flex items-center gap-2 text-[12px]">
                  <span className={`w-8 font-semibold ${t.side === 'buy' ? 'text-emerald-strong' : 'text-clay'}`}>
                    {t.side === 'buy' ? 'BUY' : 'SELL'}
                  </span>
                  <span className="text-ink-3">{t.who}</span>
                  <span className="ml-auto text-ink">{t.amount}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </main>
  )
}
