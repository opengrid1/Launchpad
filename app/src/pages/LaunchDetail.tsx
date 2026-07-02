import { useState } from 'react'
import { compact, hardCapOf, price, rewardSplit, type Launch } from '../data/launches'
import { ProgressBar } from '../components/ProgressBar'
import { StatusBadge } from '../components/StatusBadge'
import { SplitMeter } from '../components/SplitMeter'

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-pine-850/80 px-4 py-3 ring-1 ring-pine-700">
      <p className="text-[11px] font-medium uppercase tracking-wide text-sage-500">{label}</p>
      <p className="mt-1 font-mono text-sm font-semibold text-parch-100">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-sage-500">{sub}</p>}
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
    <main className="rise-in mt-6">
      <button onClick={onBack} className="cursor-pointer text-sm text-sage-500 transition hover:text-moss-300">
        ← All launches
      </button>

      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* left column */}
        <div>
          <div className="flex flex-wrap items-center gap-4">
            <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-pine-800 text-3xl ring-1 ring-pine-600">
              {launch.glyph}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3">
                <h1 className="font-display text-2xl font-semibold tracking-tight">{launch.name}</h1>
                <StatusBadge status={launch.status} />
              </div>
              <p className="mt-1 font-mono text-sm text-sage-500">
                ${launch.symbol} · by {launch.creator}
              </p>
            </div>
          </div>

          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-sage-300">{launch.tagline}</p>

          {/* raise progress */}
          <div className="mt-8 rounded-2xl bg-pine-900 p-5 ring-1 ring-pine-700">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-mono text-sm text-sage-300">
                <span className="text-xl font-bold text-parch-100">{compact(launch.raised)}</span> / {compact(hardCap)} RBH
                raised
              </p>
              <p className="font-mono text-sm text-sage-500">
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
            <div className="mt-2.5 flex justify-between font-mono text-[11px] text-sage-500">
              <span className={softMet ? 'text-moss-400' : ''}>
                soft cap {compact(launch.softCap)} {softMet ? '✓ reached' : ''}
              </span>
              <span>{pct.toFixed(1)}% of hard cap</span>
            </div>
          </div>

          {/* the split — the centerpiece */}
          <div className="relative mt-6 overflow-hidden rounded-2xl bg-pine-900 p-5 ring-1 ring-pine-700">
            <span className="stamp-r absolute top-4 right-4 rounded-md border border-gold-400/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-gold-300">
              50 / 50
            </span>
            <h2 className="font-display text-lg font-semibold">Where the fees go</h2>
            <p className="mt-1 max-w-md text-[13px] leading-relaxed text-sage-300">
              Once ${launch.symbol} graduates, every swap pays a {launch.tradeFeeBps / 100}% fee. It never
              goes to a treasury — it forks in half, in the same block.
            </p>
            <div className="mt-5">
              <SplitMeter toHolders={toHolders} toTraders={toTraders} />
            </div>
            <div className="mt-5 grid grid-cols-3 gap-3">
              <Stat label="Lifetime volume" value={`${compact(launch.volume)} RBH`} />
              <Stat label="Fee pool" value={`${compact(pool)} RBH`} sub={`${launch.tradeFeeBps / 100}% of volume`} />
              <Stat label="Holders" value={launch.holders ? launch.holders.toLocaleString() : '—'} sub="sharing the top half" />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Price" value={`${price(launch.priceRbh)} RBH`} sub="flat for everyone" />
            <Stat label="For sale" value={compact(launch.tokensForSale)} sub={`+ ${compact(launch.tokensForLiquidity)} to LP`} />
            <Stat label="To liquidity" value={`${launch.liquidityBps / 100}%`} sub="of raise · LP burned" />
            <Stat
              label="Wallet cap"
              value={launch.maxBuyPerWallet ? `${compact(launch.maxBuyPerWallet)} RBH` : 'None'}
              sub="per address"
            />
          </div>

          {/* settlement explainer */}
          <div className="mt-6 rounded-2xl bg-pine-900/60 p-5 ring-1 ring-pine-700">
            <h2 className="text-sm font-semibold text-parch-100">How this launch works</h2>
            <ol className="mt-3 space-y-2.5 text-[13px] leading-relaxed text-sage-300">
              <li className="flex gap-2.5">
                <span className="font-mono text-moss-400">1</span> Everyone buys at {price(launch.priceRbh)} RBH — one flat
                price, no curve, no early-buyer edge.
              </li>
              <li className="flex gap-2.5">
                <span className="font-mono text-moss-400">2</span> Soft cap reached → {launch.liquidityBps / 100}% of the raise
                pairs into the DEX pool and the LP is burned. The token graduates.
              </li>
              <li className="flex gap-2.5">
                <span className="font-mono text-moss-400">3</span> From then on, each trade's {launch.tradeFeeBps / 100}% fee
                splits 50/50 — half to holders, half rebated to the trader.
              </li>
              <li className="flex gap-2.5">
                <span className="font-mono text-clay-400">✗</span> Soft cap missed → every buyer refunds in full. Nobody is
                left holding the bag.
              </li>
            </ol>
          </div>
        </div>

        {/* right column: action panel */}
        <aside className="h-fit rounded-2xl bg-pine-900 p-5 ring-1 ring-pine-700 lg:sticky lg:top-6">
          {launch.status === 'live' && (
            <>
              <h2 className="text-sm font-semibold">Buy ${launch.symbol}</h2>
              <label className="mt-4 block rounded-xl bg-pine-850 p-4 ring-1 ring-pine-700 focus-within:ring-moss-500/60">
                <span className="flex justify-between text-[11px] font-medium uppercase tracking-wide text-sage-500">
                  <span>You pay</span>
                  <span>balance 1,204 RBH</span>
                </span>
                <span className="mt-1.5 flex items-center gap-2">
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.0"
                    inputMode="decimal"
                    className="w-full bg-transparent font-mono text-2xl font-semibold text-parch-100 outline-none placeholder:text-sage-500/50"
                  />
                  <span className="rounded-lg bg-pine-700 px-2.5 py-1 font-mono text-sm font-semibold text-moss-300">
                    RBH
                  </span>
                </span>
              </label>

              <div className="my-3 flex justify-center">
                <span className="rounded-full bg-pine-850 p-1.5 font-mono text-xs text-sage-500 ring-1 ring-pine-700">↓</span>
              </div>

              <div className="rounded-xl bg-pine-850 p-4 ring-1 ring-pine-700">
                <span className="text-[11px] font-medium uppercase tracking-wide text-sage-500">You receive</span>
                <p className="mt-1.5 font-mono text-2xl font-semibold text-parch-100">
                  {tokensOut ? compact(tokensOut) : '0.0'}{' '}
                  <span className="text-sm text-moss-300">{launch.symbol}</span>
                </p>
              </div>

              <button
                disabled={!rbh}
                className="mt-4 w-full cursor-pointer rounded-xl bg-moss-500 py-3 text-sm font-bold text-pine-950 transition hover:bg-moss-400 disabled:cursor-not-allowed disabled:bg-pine-700 disabled:text-sage-500"
              >
                {rbh ? `Buy at ${price(launch.priceRbh)} RBH / ${launch.symbol}` : 'Enter an amount'}
              </button>

              <p className="mt-3 text-center text-[11px] leading-relaxed text-sage-500">
                Same price as every other buyer. Hold after graduation and you start earning the holders' half.
              </p>

              {launch.yourContribution > 0 && (
                <div className="mt-4 rounded-xl bg-moss-500/8 p-3.5 text-[13px] ring-1 ring-moss-500/20">
                  <span className="text-sage-300">Your position</span>
                  <p className="mt-1 font-mono text-parch-100">
                    {compact(launch.yourContribution)} RBH → {compact(launch.yourTokens)} {launch.symbol}
                  </p>
                </div>
              )}
            </>
          )}

          {launch.status === 'upcoming' && (
            <div className="py-2 text-center">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-gold-300">Sale opens in</p>
              <p className="mt-2 font-mono text-3xl font-bold">{launch.startsIn}</p>
              <p className="mt-3 text-[13px] leading-relaxed text-sage-500">
                Price locks at {price(launch.priceRbh)} RBH per {launch.symbol}. Being early earns nothing extra —
                the rewards start once it graduates.
              </p>
              <button className="mt-5 w-full cursor-pointer rounded-xl bg-pine-800 py-3 text-sm font-semibold text-parch-100 ring-1 ring-pine-600 transition hover:ring-moss-500/50">
                Remind me
              </button>
            </div>
          )}

          {launch.status === 'graduated' && (
            <div className="py-2">
              <p className="text-center font-mono text-xs uppercase tracking-[0.2em] text-moss-400">Graduated ✓</p>
              <p className="mt-3 text-center text-[13px] leading-relaxed text-sage-300">
                Liquidity is live and the split is running. Here's what's waiting for you.
              </p>

              <div className="mt-4 space-y-2.5">
                <div className="flex items-center justify-between rounded-xl bg-moss-500/10 px-4 py-3 ring-1 ring-moss-500/25">
                  <span className="text-[12px] text-moss-300">As a holder (50%)</span>
                  <span className="font-mono text-sm font-semibold text-parch-100">{compact(launch.yourHolderRewards)} RBH</span>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-gold-400/10 px-4 py-3 ring-1 ring-gold-400/25">
                  <span className="text-[12px] text-gold-300">Trade rebates (50%)</span>
                  <span className="font-mono text-sm font-semibold text-parch-100">{compact(launch.yourRebate)} RBH</span>
                </div>
              </div>

              <button
                disabled={claimable <= 0}
                className="mt-4 w-full cursor-pointer rounded-xl bg-moss-500 py-3 text-sm font-bold text-pine-950 transition hover:bg-moss-400 disabled:cursor-not-allowed disabled:bg-pine-700 disabled:text-sage-500"
              >
                {claimable > 0 ? `Claim ${compact(claimable)} RBH` : 'Nothing to claim yet'}
              </button>
              <p className="mt-2.5 text-center text-[11px] text-sage-500">Rewards keep accruing every time ${launch.symbol} trades.</p>
            </div>
          )}

          {launch.status === 'refunding' && (
            <div className="py-2 text-center">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-clay-400">Soft cap missed</p>
              <p className="mt-3 text-[13px] leading-relaxed text-sage-300">
                This launch didn't reach its soft cap, so every contribution is refundable in full.
              </p>
              <div className="mt-4 rounded-xl bg-pine-850 p-4 ring-1 ring-pine-700">
                <span className="text-[11px] uppercase tracking-wide text-sage-500">Your refund</span>
                <p className="mt-1 font-mono text-2xl font-semibold">
                  {compact(launch.yourContribution)} <span className="text-sm text-clay-400">RBH</span>
                </p>
              </div>
              <button className="mt-4 w-full cursor-pointer rounded-xl bg-clay-400/90 py-3 text-sm font-bold text-pine-950 transition hover:bg-clay-400">
                Refund RBH
              </button>
            </div>
          )}
        </aside>
      </div>
    </main>
  )
}
