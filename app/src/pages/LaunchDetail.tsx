import { useState } from 'react'
import { compact, hardCapOf, price, rewardSplit, type Launch } from '../data/launches'
import { ProgressBar } from '../components/ProgressBar'
import { StatusBadge } from '../components/StatusBadge'
import { SplitMeter } from '../components/SplitMeter'
import { Monogram } from '../components/Monogram'

function Figure({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-[120px] flex-1">
      <p className="eyebrow">{label}</p>
      <p className="tnum mt-1.5 text-[16px] text-ink">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-ink-3">{sub}</p>}
    </div>
  )
}

const TAPE: [string, string, string, string][] = [
  ['2 min ago', 'bought', '0x9f…2a1d', '1,200 RBH'],
  ['3 min ago', 'bought', '0x3c…88fe', '340 RBH'],
  ['5 min ago', 'claimed', '0x71…9F02', '46.2 RBH'],
  ['6 min ago', 'bought', '0xaa…04c1', '2,000 RBH'],
  ['9 min ago', 'rebate', '0x5d…4a0b', '12.8 RBH'],
  ['12 min ago', 'bought', '0x08…b3c2', '880 RBH'],
  ['15 min ago', 'bought', '0xdd…4f19', '150 RBH'],
]

type Tab = 'buy' | 'rewards' | 'activity'

export function LaunchDetail({ launch, onBack }: { launch: Launch; onBack: () => void }) {
  const [amount, setAmount] = useState('')
  const [tab, setTab] = useState<Tab>('buy')
  const [showAll, setShowAll] = useState(false)
  const hardCap = hardCapOf(launch)
  const pct = Math.min(100, (launch.raised / hardCap) * 100)
  const softMet = launch.raised >= launch.softCap
  const rbh = parseFloat(amount) || 0
  const tokensOut = rbh / launch.priceRbh
  const { pool, toHolders, toTraders } = rewardSplit(launch)
  const claimable = launch.yourHolderRewards + launch.yourRebate
  const tape = showAll ? TAPE : TAPE.slice(0, 4)

  const primaryBtn =
    'w-full cursor-pointer rounded-full bg-ink py-3 text-[14px] font-medium text-paper transition hover:bg-emerald-strong disabled:cursor-not-allowed disabled:bg-panel disabled:text-ink-3'

  return (
    <main className="rise-in py-8">
      <button onClick={onBack} className="text-[13px] text-ink-2 transition-colors hover:text-ink">
        ← All launches
      </button>

      <div className="mt-8 grid gap-x-14 gap-y-10 lg:grid-cols-[1fr_340px]">
        {/* left column */}
        <div>
          <div className="flex items-center gap-4">
            <Monogram symbol={launch.symbol} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h1 className="font-display text-[36px] font-medium leading-none tracking-tight">{launch.name}</h1>
                <StatusBadge status={launch.status} />
              </div>
              <p className="tnum mt-2 text-[12px] text-ink-3">{launch.symbol} · by {launch.creator}</p>
            </div>
          </div>

          <p className="mt-6 max-w-xl font-display text-[19px] italic leading-relaxed text-ink-2">
            {launch.tagline}
          </p>

          {/* raise */}
          <div className="rule-t mt-10 pt-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="tnum text-ink-2">
                <span className="text-[26px] text-ink">{compact(launch.raised)}</span>
                <span className="text-[15px]"> of {compact(hardCap)} RBH</span>
              </p>
              <p className="tnum text-[12px] text-ink-3">
                {launch.buyers.toLocaleString()} buyers ·{' '}
                {launch.startsIn ? `opens in ${launch.startsIn}` : launch.endsIn ? `${launch.endsIn} left` : launch.endedAgo}
              </p>
            </div>
            <div className="mt-4">
              <ProgressBar launch={launch} tall />
            </div>
            <div className="tnum mt-3 flex justify-between text-[12px]">
              <span className={softMet ? 'text-emerald-strong' : 'text-ink-3'}>
                soft cap {compact(launch.softCap)}{softMet ? ' · reached' : ''}
              </span>
              <span className="text-ink-3">{pct.toFixed(1)}% of hard cap</span>
            </div>
          </div>

          {/* the split, the argument of the whole thing */}
          <div className="rule-t mt-10 pt-8">
            <h2 className="font-display text-[24px] font-medium tracking-tight">Where the fees go</h2>
            <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-ink-2">
              Once {launch.symbol} graduates, every swap pays a {launch.tradeFeeBps / 100}% fee. It splits in half
              the same block it settles. No treasury sits in between.
            </p>
            <div className="mt-6 max-w-xl">
              <SplitMeter toHolders={toHolders} toTraders={toTraders} />
            </div>
            <div className="mt-8 flex flex-wrap gap-y-5">
              <Figure label="Lifetime volume" value={`${compact(launch.volume)} RBH`} />
              <Figure label="Fee pool" value={`${compact(pool)} RBH`} sub={`${launch.tradeFeeBps / 100}% of volume`} />
              <Figure label="Holders" value={launch.holders ? launch.holders.toLocaleString() : 'None yet'} sub="sharing the top half" />
            </div>
          </div>

          {/* parameters */}
          <div className="rule-t mt-10 flex flex-wrap gap-y-5 pt-6">
            <Figure label="Price" value={`${price(launch.priceRbh)} RBH`} sub="flat for everyone" />
            <Figure label="For sale" value={compact(launch.tokensForSale)} sub={`+${compact(launch.tokensForLiquidity)} to LP`} />
            <Figure label="To liquidity" value={`${launch.liquidityBps / 100}%`} sub="of raise · LP burned" />
            <Figure label="Wallet cap" value={launch.maxBuyPerWallet ? `${compact(launch.maxBuyPerWallet)} RBH` : 'None'} sub="per address" />
          </div>

          {/* lifecycle */}
          <div className="rule-t mt-10 pt-8">
            <h2 className="font-display text-[24px] font-medium tracking-tight">How this launch works</h2>
            <ol className="mt-5 space-y-5">
              {[
                `Everyone buys at ${price(launch.priceRbh)} RBH. One flat price, no curve, no early-buyer edge.`,
                `Soft cap reached. ${launch.liquidityBps / 100}% of the raise pairs into the DEX pool and the LP is burned. The token graduates.`,
                `From then on, each trade's ${launch.tradeFeeBps / 100}% fee splits 50/50. Half to holders, half rebated to the trader.`,
                `Soft cap missed. Every buyer refunds in full. Nobody is left holding the bag.`,
              ].map((t, i) => (
                <li key={i} className="flex gap-5 text-[14px] leading-relaxed text-ink-2">
                  <span className="font-display shrink-0 text-[20px] leading-none text-emerald-strong">{i < 3 ? i + 1 : '·'}</span>
                  <span className="pt-0.5">{t}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* action rail */}
        <aside className="h-fit rounded-2xl bg-surface p-5 lg:sticky lg:top-6">
          <div className="flex gap-5 border-b border-line pb-3">
            {(['buy', 'rewards', 'activity'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`cursor-pointer text-[13px] capitalize transition-colors ${
                  tab === t ? 'text-ink' : 'text-ink-3 hover:text-ink-2'
                }`}
              >
                {t}
                {tab === t && <span className="mt-1.5 block h-px bg-emerald" />}
              </button>
            ))}
          </div>

          <div className="pt-4">
            {tab === 'buy' && launch.status === 'live' && (
              <>
                <label className="block">
                  <span className="flex items-baseline justify-between">
                    <span className="eyebrow">You pay</span>
                    <span className="tnum text-[11px] text-ink-3">balance 1,204 RBH</span>
                  </span>
                  <span className="mt-2 flex items-baseline gap-2 border-b border-line-2 pb-2 focus-within:border-emerald">
                    <input
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.0"
                      inputMode="decimal"
                      className="tnum w-full bg-transparent text-[26px] text-ink outline-none placeholder:text-ink-3/40"
                    />
                    <span className="text-[14px] text-ink-3">RBH</span>
                  </span>
                </label>
                <p className="tnum mt-3 text-[13px] text-ink-2">
                  You receive <span className="text-ink">{tokensOut ? compact(tokensOut) : '0'} {launch.symbol}</span>
                </p>
                <button disabled={!rbh} className={`mt-5 ${primaryBtn}`}>
                  {rbh ? `Buy ${launch.symbol}` : 'Enter an amount'}
                </button>
                <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
                  Flat price for every buyer. Hold past graduation to earn the holders' half of every trade.
                </p>
                {launch.yourContribution > 0 && (
                  <p className="tnum mt-4 border-t border-line pt-3 text-[12px] text-ink-2">
                    Your position: {compact(launch.yourContribution)} RBH in, {compact(launch.yourTokens)} {launch.symbol}
                  </p>
                )}
              </>
            )}

            {tab === 'buy' && launch.status === 'upcoming' && (
              <div className="text-center">
                <p className="eyebrow text-emerald">Opens in</p>
                <p className="tnum mt-2 font-display text-[38px] font-medium leading-none">{launch.startsIn}</p>
                <p className="mt-4 text-[13px] leading-relaxed text-ink-2">
                  Price locks at {price(launch.priceRbh)} RBH per {launch.symbol}. Being early buys you nothing extra.
                </p>
                <button className={`mt-5 ${primaryBtn}`}>Remind me</button>
              </div>
            )}

            {tab === 'buy' && launch.status === 'graduated' && (
              <div className="text-center">
                <p className="eyebrow text-emerald">Graduated</p>
                <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
                  Trading has moved on-chain. Rewards accrue on every swap. Check the rewards tab.
                </p>
                <button onClick={() => setTab('rewards')} className={`mt-5 ${primaryBtn}`}>See rewards</button>
              </div>
            )}

            {tab === 'buy' && launch.status === 'refunding' && (
              <div className="text-center">
                <p className="eyebrow text-clay">Soft cap missed</p>
                <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
                  This launch didn't clear its soft cap, so every contribution is fully refundable.
                </p>
                <p className="tnum mt-4 text-[24px] text-clay">{compact(launch.yourContribution)} RBH</p>
                <p className="eyebrow">your refund</p>
                <button className={`mt-4 ${primaryBtn}`}>Refund my RBH</button>
              </div>
            )}

            {tab === 'rewards' && (
              <>
                <div className="space-y-3">
                  <p className="tnum flex items-baseline justify-between text-[13px]">
                    <span className="text-ink-2">Holder share</span>
                    <span className="text-ink">{compact(launch.yourHolderRewards)} RBH</span>
                  </p>
                  <p className="tnum flex items-baseline justify-between text-[13px]">
                    <span className="text-ink-2">Trade rebates</span>
                    <span className="text-ink">{compact(launch.yourRebate)} RBH</span>
                  </p>
                </div>
                <button disabled={claimable <= 0} className={`mt-5 ${primaryBtn}`}>
                  {claimable > 0 ? `Claim ${compact(claimable)} RBH` : 'Nothing to claim yet'}
                </button>
                <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
                  Accrues on every {launch.symbol} trade. Claim whenever you like. There is no lockup.
                </p>
              </>
            )}

            {tab === 'activity' && (
              <>
                <ul className="space-y-2.5">
                  {tape.map(([when, kind, who, amt], i) => (
                    <li key={i} className="flex items-baseline gap-2 text-[12px]">
                      <span className={kind === 'bought' ? 'text-emerald-strong' : kind === 'rebate' ? 'text-gold' : 'text-ink-2'}>{kind}</span>
                      <span className="tnum text-ink-3">{who}</span>
                      <span className="tnum ml-auto text-ink">{amt}</span>
                      <span className="tnum w-16 shrink-0 text-right text-ink-3">{when}</span>
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => setShowAll((v) => !v)}
                  className="mt-4 text-[12px] text-ink-2 underline decoration-line-2 underline-offset-4 transition-colors hover:text-ink"
                >
                  {showAll ? 'Show less' : 'Show more'}
                </button>
              </>
            )}
          </div>
        </aside>
      </div>
    </main>
  )
}
