import { useState } from 'react'
import { compact, hardCapOf, price, rewardSplit, type Launch } from '../data/launches'
import { ProgressBar } from '../components/ProgressBar'
import { StatusBadge } from '../components/StatusBadge'
import { SplitMeter } from '../components/SplitMeter'
import { Monogram } from '../components/Monogram'

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-[12px] text-ink-3">{label}</p>
      <p className="tnum mt-1 text-[15px] font-semibold text-ink">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-ink-3">{sub}</p>}
    </div>
  )
}

export function LaunchDetail({ launch, onBack }: { launch: Launch; onBack: () => void }) {
  const [amount, setAmount] = useState('')
  const hardCap = hardCapOf(launch)
  const pct = Math.min(100, (launch.raised / hardCap) * 100)
  const softMet = launch.raised >= launch.softCap
  const rbh = parseFloat(amount) || 0
  const tokensOut = rbh / launch.priceRbh
  const { pool, toHolders, toTraders } = rewardSplit(launch)
  const claimable = launch.yourHolderRewards + launch.yourRebate

  return (
    <main className="rise-in py-10">
      <button onClick={onBack} className="cursor-pointer text-[13px] text-ink-3 transition hover:text-ink">
        ← All launches
      </button>

      <div className="mt-6 grid gap-12 lg:grid-cols-[1fr_352px]">
        {/* left column */}
        <div>
          <div className="flex flex-wrap items-center gap-4">
            <Monogram symbol={launch.symbol} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3">
                <h1 className="font-display text-[28px] font-semibold tracking-tight">{launch.name}</h1>
                <StatusBadge status={launch.status} />
              </div>
              <p className="tnum mt-1 text-[13px] text-ink-3">
                {launch.symbol} · deployed by {launch.creator}
              </p>
            </div>
          </div>

          <p className="mt-5 max-w-xl text-[16px] leading-relaxed text-ink-2">{launch.tagline}</p>

          {/* raise progress */}
          <div className="mt-9 border-t border-line pt-7">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="tnum text-[15px] text-ink-2">
                <span className="text-[22px] font-semibold tracking-tight text-ink">{compact(launch.raised)}</span> / {compact(hardCap)} RBH raised
              </p>
              <p className="tnum text-[13px] text-ink-3">
                {launch.buyers.toLocaleString()} buyers ·{' '}
                {launch.startsIn
                  ? `starts in ${launch.startsIn}`
                  : launch.endsIn
                    ? `ends in ${launch.endsIn}`
                    : `ended ${launch.endedAgo}`}
              </p>
            </div>
            <div className="mt-4">
              <ProgressBar launch={launch} tall />
            </div>
            <div className="tnum mt-2 flex justify-between text-[12px] text-ink-3">
              <span className={softMet ? 'text-emerald' : ''}>
                soft cap {compact(launch.softCap)} {softMet ? '· reached' : ''}
              </span>
              <span>{pct.toFixed(1)}% of hard cap</span>
            </div>
          </div>

          {/* the split — the centerpiece */}
          <div className="mt-10 rounded-2xl border border-line bg-surface p-6">
            <div className="flex items-baseline justify-between">
              <h2 className="font-display text-[19px] font-semibold tracking-tight">Where the fees go</h2>
              <span className="tnum text-[12px] text-ink-3">50 / 50, fixed</span>
            </div>
            <p className="mt-2 max-w-lg text-[14px] leading-relaxed text-ink-2">
              Once {launch.symbol} graduates, every swap pays a {launch.tradeFeeBps / 100}% fee. It never lands
              in a treasury — it forks in half in the same block.
            </p>
            <div className="mt-6">
              <SplitMeter toHolders={toHolders} toTraders={toTraders} />
            </div>
            <div className="mt-6 grid grid-cols-3 gap-4 border-t border-line pt-5">
              <Stat label="Lifetime volume" value={`${compact(launch.volume)} RBH`} />
              <Stat label="Fee pool" value={`${compact(pool)} RBH`} sub={`${launch.tradeFeeBps / 100}% of volume`} />
              <Stat label="Holders" value={launch.holders ? launch.holders.toLocaleString() : '—'} sub="sharing the top half" />
            </div>
          </div>

          <div className="mt-8 grid grid-cols-2 gap-6 border-t border-line pt-7 sm:grid-cols-4">
            <Stat label="Price" value={`${price(launch.priceRbh)} RBH`} sub="flat for everyone" />
            <Stat label="For sale" value={compact(launch.tokensForSale)} sub={`+ ${compact(launch.tokensForLiquidity)} to LP`} />
            <Stat label="To liquidity" value={`${launch.liquidityBps / 100}%`} sub="of raise · LP burned" />
            <Stat
              label="Wallet cap"
              value={launch.maxBuyPerWallet ? `${compact(launch.maxBuyPerWallet)} RBH` : 'None'}
              sub="per address"
            />
          </div>

          {/* how it works */}
          <div className="mt-10 border-t border-line pt-7">
            <h2 className="font-display text-[17px] font-semibold tracking-tight">How this launch works</h2>
            <ol className="mt-4 space-y-4">
              {[
                `Everyone buys at ${price(launch.priceRbh)} RBH — one flat price, no curve, no early-buyer edge.`,
                `Soft cap reached → ${launch.liquidityBps / 100}% of the raise pairs into the DEX pool and the LP is burned. The token graduates.`,
                `From then on, each trade's ${launch.tradeFeeBps / 100}% fee splits 50/50 — half to holders, half rebated to the trader.`,
                `Soft cap missed → every buyer refunds in full. Nobody is left holding the bag.`,
              ].map((t, i) => (
                <li key={i} className="flex gap-4 text-[14px] leading-relaxed text-ink-2">
                  <span className="tnum shrink-0 text-[13px] font-semibold text-ink-3">{i < 3 ? `0${i + 1}` : '—'}</span>
                  {t}
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* right column: action panel */}
        <aside className="h-fit rounded-2xl border border-line bg-surface p-5 lg:sticky lg:top-6">
          {launch.status === 'live' && (
            <>
              <h2 className="text-[13px] font-semibold text-ink">Buy {launch.symbol}</h2>
              <label className="mt-4 block rounded-xl border border-line bg-paper p-4 transition focus-within:border-line-2">
                <span className="flex justify-between text-[11px] font-medium uppercase tracking-[0.1em] text-ink-3">
                  <span>You pay</span>
                  <span className="tnum">balance 1,204 RBH</span>
                </span>
                <span className="mt-2 flex items-center gap-2">
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.0"
                    inputMode="decimal"
                    className="tnum w-full bg-transparent text-2xl font-semibold text-ink outline-none placeholder:text-ink-3/50"
                  />
                  <span className="tnum rounded-md bg-panel px-2.5 py-1 text-sm font-semibold text-ink">RBH</span>
                </span>
              </label>

              <div className="my-2.5 flex justify-center text-ink-3">↓</div>

              <div className="rounded-xl border border-line bg-paper p-4">
                <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-ink-3">You receive</span>
                <p className="tnum mt-2 text-2xl font-semibold text-ink">
                  {tokensOut ? compact(tokensOut) : '0.0'} <span className="text-sm font-medium text-ink-3">{launch.symbol}</span>
                </p>
              </div>

              <button
                disabled={!rbh}
                className="mt-4 w-full cursor-pointer rounded-lg bg-ink py-3 text-sm font-medium text-paper transition hover:bg-emerald-strong disabled:cursor-not-allowed disabled:bg-panel disabled:text-ink-3"
              >
                {rbh ? `Buy at ${price(launch.priceRbh)} RBH / ${launch.symbol}` : 'Enter an amount'}
              </button>

              <p className="mt-3 text-center text-[12px] leading-relaxed text-ink-3">
                Same price as every buyer. Hold after graduation and you start earning the holders' half.
              </p>

              {launch.yourContribution > 0 && (
                <div className="tnum mt-4 rounded-xl bg-emerald-tint p-3.5 text-[13px] text-emerald-strong">
                  Your position: {compact(launch.yourContribution)} RBH → {compact(launch.yourTokens)} {launch.symbol}
                </div>
              )}
            </>
          )}

          {launch.status === 'upcoming' && (
            <div className="text-center">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-gold">Sale opens in</p>
              <p className="tnum mt-2 text-4xl font-semibold tracking-tight">{launch.startsIn}</p>
              <p className="mt-4 text-[13px] leading-relaxed text-ink-2">
                Price locks at {price(launch.priceRbh)} RBH per {launch.symbol}. Being early earns nothing extra —
                rewards start once it graduates.
              </p>
              <button className="mt-5 w-full cursor-pointer rounded-lg border border-line py-3 text-sm font-medium text-ink transition hover:border-line-2">
                Remind me
              </button>
            </div>
          )}

          {launch.status === 'graduated' && (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-emerald">Graduated</p>
              <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
                Liquidity is live and the split is running. Here's what's waiting for you.
              </p>

              <div className="mt-4 divide-y divide-line rounded-xl border border-line">
                <div className="tnum flex items-center justify-between px-4 py-3 text-[13px]">
                  <span className="text-ink-2">As a holder (50%)</span>
                  <span className="font-semibold text-ink">{compact(launch.yourHolderRewards)} RBH</span>
                </div>
                <div className="tnum flex items-center justify-between px-4 py-3 text-[13px]">
                  <span className="text-ink-2">Trade rebates (50%)</span>
                  <span className="font-semibold text-ink">{compact(launch.yourRebate)} RBH</span>
                </div>
              </div>

              <button
                disabled={claimable <= 0}
                className="mt-4 w-full cursor-pointer rounded-lg bg-ink py-3 text-sm font-medium text-paper transition hover:bg-emerald-strong disabled:cursor-not-allowed disabled:bg-panel disabled:text-ink-3"
              >
                {claimable > 0 ? `Claim ${compact(claimable)} RBH` : 'Nothing to claim yet'}
              </button>
              <p className="mt-3 text-center text-[12px] text-ink-3">Rewards accrue every time {launch.symbol} trades.</p>
            </div>
          )}

          {launch.status === 'refunding' && (
            <div className="text-center">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-clay">Soft cap missed</p>
              <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
                This launch didn't reach its soft cap, so every contribution is refundable in full.
              </p>
              <div className="mt-4 rounded-xl border border-line bg-paper p-4">
                <span className="text-[11px] uppercase tracking-[0.1em] text-ink-3">Your refund</span>
                <p className="tnum mt-1 text-2xl font-semibold">{compact(launch.yourContribution)} <span className="text-sm text-clay">RBH</span></p>
              </div>
              <button className="mt-4 w-full cursor-pointer rounded-lg bg-clay py-3 text-sm font-medium text-paper transition hover:opacity-90">
                Refund RBH
              </button>
            </div>
          )}
        </aside>
      </div>
    </main>
  )
}
