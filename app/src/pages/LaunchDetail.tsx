import { useState } from 'react'
import { compact, hardCapOf, price, rewardSplit, type Launch } from '../data/launches'
import { ProgressBar } from '../components/ProgressBar'
import { StatusBadge } from '../components/StatusBadge'
import { SplitMeter } from '../components/SplitMeter'
import { Monogram } from '../components/Monogram'

function Cell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="px-4 py-3">
      <p className="label">{label}</p>
      <p className="tnum mt-1.5 text-[14px] font-medium text-ink">{value}</p>
      {sub && <p className="mt-0.5 text-[10px] text-ink-3">{sub}</p>}
    </div>
  )
}

// mock event tape for the activity feed
const TAPE: [string, string, string, string][] = [
  ['14:02:11', 'BUY', '0x9f…2a1d', '+1,200 RBH'],
  ['14:01:47', 'BUY', '0x3c…88fe', '+340 RBH'],
  ['13:59:02', 'CLAIM', '0x71…9F02', '+46.2 RBH'],
  ['13:58:20', 'BUY', '0xaa…04c1', '+2,000 RBH'],
  ['13:55:09', 'REBATE', '0x5d…4a0b', '+12.8 RBH'],
  ['13:52:44', 'BUY', '0x08…b3c2', '+880 RBH'],
  ['13:50:31', 'BUY', '0xdd…4f19', '+150 RBH'],
]

type Tab = 'trade' | 'rewards' | 'activity'

export function LaunchDetail({ launch, onBack }: { launch: Launch; onBack: () => void }) {
  const [amount, setAmount] = useState('')
  const [tab, setTab] = useState<Tab>('trade')
  const [showAll, setShowAll] = useState(false)
  const hardCap = hardCapOf(launch)
  const pct = Math.min(100, (launch.raised / hardCap) * 100)
  const softMet = launch.raised >= launch.softCap
  const rbh = parseFloat(amount) || 0
  const tokensOut = rbh / launch.priceRbh
  const { pool, toHolders, toTraders } = rewardSplit(launch)
  const claimable = launch.yourHolderRewards + launch.yourRebate
  const tape = showAll ? TAPE : TAPE.slice(0, 4)

  return (
    <main className="rise-in py-8">
      <button onClick={onBack} className="label cursor-pointer transition-colors hover:text-ink-2">
        ← BACK TO MARKETS
      </button>

      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_336px]">
        {/* left column */}
        <div>
          <div className="flex flex-wrap items-center gap-4">
            <Monogram symbol={launch.symbol} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3">
                <h1 className="font-display text-[24px] font-semibold tracking-tight">{launch.name}</h1>
                <StatusBadge status={launch.status} />
              </div>
              <p className="tnum mt-1 text-[12px] text-ink-3">
                {launch.symbol} · deployed by {launch.creator}
              </p>
            </div>
          </div>

          <p className="mt-5 max-w-xl text-[14px] leading-relaxed text-ink-2">{launch.tagline}</p>

          {/* raise progress */}
          <div className="mt-8 border border-line">
            <div className="flex items-center justify-between border-b border-line px-4 py-2">
              <span className="label">// RAISE</span>
              <span className="tnum label">{pct.toFixed(1)}% OF HARD CAP</span>
            </div>
            <div className="px-4 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="tnum text-[13px] text-ink-3">
                  <span className="text-[20px] font-semibold text-ink">{compact(launch.raised)}</span> / {compact(hardCap)} RBH
                </p>
                <p className="tnum text-[11px] text-ink-3">
                  {launch.buyers.toLocaleString()} buyers ·{' '}
                  {launch.startsIn ? `T-${launch.startsIn}` : launch.endsIn ? `${launch.endsIn} left` : launch.endedAgo}
                </p>
              </div>
              <div className="mt-3">
                <ProgressBar launch={launch} tall />
              </div>
              <div className="tnum mt-2 flex justify-between text-[11px]">
                <span className={softMet ? 'text-emerald' : 'text-ink-3'}>
                  soft cap {compact(launch.softCap)} {softMet ? '· reached' : ''}
                </span>
              </div>
            </div>
          </div>

          {/* the split — centerpiece */}
          <div className="mt-6 border border-line">
            <div className="flex items-center justify-between border-b border-line px-4 py-2">
              <span className="label">// FEE SPLIT</span>
              <span className="label">50 / 50 · FIXED</span>
            </div>
            <div className="px-4 py-4">
              <p className="max-w-lg text-[13px] leading-relaxed text-ink-2">
                Once {launch.symbol} graduates, every swap pays a {launch.tradeFeeBps / 100}% fee. It never lands
                in a treasury — it forks in half, same block.
              </p>
              <div className="mt-5">
                <SplitMeter toHolders={toHolders} toTraders={toTraders} />
              </div>
            </div>
            <div className="grid grid-cols-3 divide-x divide-line border-t border-line">
              <Cell label="VOLUME" value={`${compact(launch.volume)}`} sub="RBH lifetime" />
              <Cell label="FEE POOL" value={`${compact(pool)}`} sub={`${launch.tradeFeeBps / 100}% of vol`} />
              <Cell label="HOLDERS" value={launch.holders ? launch.holders.toLocaleString() : '—'} sub="on the split" />
            </div>
          </div>

          {/* parameters */}
          <div className="mt-6 grid grid-cols-2 divide-x divide-y divide-line border border-line sm:grid-cols-4 sm:divide-y-0">
            <Cell label="PRICE" value={`${price(launch.priceRbh)}`} sub="RBH · flat" />
            <Cell label="FOR SALE" value={compact(launch.tokensForSale)} sub={`+${compact(launch.tokensForLiquidity)} LP`} />
            <Cell label="LIQUIDITY" value={`${launch.liquidityBps / 100}%`} sub="LP burned" />
            <Cell label="WALLET CAP" value={launch.maxBuyPerWallet ? compact(launch.maxBuyPerWallet) : 'NONE'} sub="per addr" />
          </div>

          {/* how it works */}
          <div className="mt-6 border border-line">
            <div className="border-b border-line px-4 py-2">
              <span className="label">// LIFECYCLE</span>
            </div>
            <ol className="divide-y divide-line">
              {[
                `Everyone buys at ${price(launch.priceRbh)} RBH — one flat price, no curve, no early-buyer edge.`,
                `Soft cap reached → ${launch.liquidityBps / 100}% of the raise pairs into the DEX pool, LP burned. Token graduates.`,
                `Each trade's ${launch.tradeFeeBps / 100}% fee then splits 50/50 — half to holders, half rebated to the trader.`,
                `Soft cap missed → every buyer refunds in full. Nobody is left holding the bag.`,
              ].map((t, i) => (
                <li key={i} className="flex gap-4 px-4 py-3 text-[13px] leading-relaxed text-ink-2">
                  <span className="tnum shrink-0 text-emerald">{i < 3 ? `0${i + 1}` : 'XX'}</span>
                  {t}
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* right column: tabbed action panel */}
        <aside className="h-fit border border-line lg:sticky lg:top-6">
          <div className="flex divide-x divide-line border-b border-line">
            {(['trade', 'rewards', 'activity'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 cursor-pointer py-2.5 text-[11px] tracking-[0.12em] uppercase transition-colors ${
                  tab === t ? 'bg-panel text-ink' : 'text-ink-3 hover:text-ink-2'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="p-4">
            {tab === 'trade' && launch.status === 'live' && (
              <>
                <label className="block border border-line bg-panel p-3">
                  <span className="flex justify-between">
                    <span className="label">YOU PAY</span>
                    <span className="tnum label">BAL 1,204 RBH</span>
                  </span>
                  <span className="mt-2 flex items-center gap-2">
                    <input
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.0"
                      inputMode="decimal"
                      className="tnum w-full bg-transparent text-[22px] font-medium text-ink outline-none placeholder:text-ink-3/40"
                    />
                    <span className="tnum border border-line-2 px-2 py-0.5 text-[12px] text-ink-2">RBH</span>
                  </span>
                </label>
                <div className="my-2 text-center text-ink-3">↓</div>
                <div className="border border-line bg-panel p-3">
                  <span className="label">YOU RECEIVE</span>
                  <p className="tnum mt-2 text-[22px] font-medium text-ink">
                    {tokensOut ? compact(tokensOut) : '0.0'} <span className="text-[13px] text-ink-3">{launch.symbol}</span>
                  </p>
                </div>
                <button
                  disabled={!rbh}
                  className="mt-4 w-full cursor-pointer border border-emerald/40 bg-emerald-tint py-2.5 text-[13px] text-emerald-strong transition-colors hover:border-emerald/70 disabled:cursor-not-allowed disabled:border-line disabled:bg-transparent disabled:text-ink-3"
                >
                  {rbh ? `[ EXECUTE BUY · ${price(launch.priceRbh)} RBH ]` : 'ENTER AMOUNT'}
                </button>
                <p className="mt-3 text-[10px] leading-relaxed text-ink-3">
                  &gt; Flat price for every buyer. Hold post-graduation to earn the holders' half.
                </p>
                {launch.yourContribution > 0 && (
                  <div className="tnum mt-3 border border-line bg-panel px-3 py-2 text-[11px] text-ink-2">
                    POSITION: {compact(launch.yourContribution)} RBH → {compact(launch.yourTokens)} {launch.symbol}
                  </div>
                )}
              </>
            )}

            {tab === 'trade' && launch.status === 'upcoming' && (
              <div className="py-2 text-center">
                <p className="label text-emerald">SALE OPENS IN</p>
                <p className="tnum mt-2 text-[30px] font-semibold">{launch.startsIn}</p>
                <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
                  Price locks at {price(launch.priceRbh)} RBH / {launch.symbol}. Early buyers earn nothing extra.
                </p>
                <button className="mt-4 w-full cursor-pointer border border-line-2 py-2.5 text-[13px] text-ink-2 transition-colors hover:text-ink">
                  [ set reminder ]
                </button>
              </div>
            )}

            {tab === 'trade' && launch.status === 'graduated' && (
              <div className="py-2 text-center">
                <p className="label text-emerald">GRADUATED · POOL LIVE</p>
                <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
                  Trading has moved on-DEX. Rewards accrue every swap — see the REWARDS tab.
                </p>
                <button
                  onClick={() => setTab('rewards')}
                  className="mt-4 w-full cursor-pointer border border-emerald/40 bg-emerald-tint py-2.5 text-[13px] text-emerald-strong transition-colors hover:border-emerald/70"
                >
                  [ view rewards ]
                </button>
              </div>
            )}

            {tab === 'trade' && launch.status === 'refunding' && (
              <div className="py-2 text-center">
                <p className="label text-clay">SOFT CAP MISSED</p>
                <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
                  This launch didn't clear its soft cap. Every contribution is refundable in full.
                </p>
                <div className="tnum mt-3 border border-line bg-panel px-3 py-3">
                  <span className="label">YOUR REFUND</span>
                  <p className="tnum mt-1 text-[20px] font-medium text-clay">{compact(launch.yourContribution)} RBH</p>
                </div>
                <button className="mt-3 w-full cursor-pointer border border-clay/40 py-2.5 text-[13px] text-clay transition-colors hover:border-clay/70">
                  [ refund RBH ]
                </button>
              </div>
            )}

            {tab === 'rewards' && (
              <>
                <div className="divide-y divide-line border border-line">
                  <div className="tnum flex items-center justify-between px-3 py-2.5 text-[12px]">
                    <span className="text-ink-2">HOLDER · 50%</span>
                    <span className="font-medium text-ink">{compact(launch.yourHolderRewards)} RBH</span>
                  </div>
                  <div className="tnum flex items-center justify-between px-3 py-2.5 text-[12px]">
                    <span className="text-ink-2">REBATE · 50%</span>
                    <span className="font-medium text-ink">{compact(launch.yourRebate)} RBH</span>
                  </div>
                </div>
                <button
                  disabled={claimable <= 0}
                  className="mt-4 w-full cursor-pointer border border-emerald/40 bg-emerald-tint py-2.5 text-[13px] text-emerald-strong transition-colors hover:border-emerald/70 disabled:cursor-not-allowed disabled:border-line disabled:bg-transparent disabled:text-ink-3"
                >
                  {claimable > 0 ? `[ CLAIM ${compact(claimable)} RBH ]` : 'NOTHING TO CLAIM'}
                </button>
                <p className="mt-3 text-[10px] leading-relaxed text-ink-3">
                  &gt; Accrues on every {launch.symbol} trade. Claim any time; no lockup.
                </p>
              </>
            )}

            {tab === 'activity' && (
              <>
                <div className="divide-y divide-line border border-line">
                  {tape.map(([t, kind, who, amt], i) => (
                    <div key={i} className="tnum flex items-center gap-2 px-3 py-2 text-[11px]">
                      <span className="text-ink-3">{t}</span>
                      <span className={`w-14 ${kind === 'BUY' ? 'text-emerald' : kind === 'REFUND' ? 'text-clay' : 'text-ink-2'}`}>{kind}</span>
                      <span className="flex-1 text-ink-3">{who}</span>
                      <span className="text-ink">{amt}</span>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => setShowAll((v) => !v)}
                  className="label mt-3 w-full cursor-pointer border border-line py-2 transition-colors hover:border-line-2 hover:text-ink-2"
                >
                  {showAll ? '− COLLAPSE' : '+ EXPAND FEED'}
                </button>
              </>
            )}
          </div>
        </aside>
      </div>
    </main>
  )
}
