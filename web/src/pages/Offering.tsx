import { useState } from 'react'
import {
  hardCapOf,
  protocolFeeBps,
  eth,
  par,
  tokens,
  compact,
  WALLET,
  type Offering as TOffering,
} from '../data/offerings'
import { Mark } from '../components/Mark'
import { Meter } from '../components/Meter'
import { StatusTag } from '../components/StatusTag'
import { ParLine } from '../components/ParLine'

function Term({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-rule py-2.5 last:border-0">
      <dt className="text-[13px] text-ink-2">{label}</dt>
      <dd className="text-right">
        <span className="tnum font-mono text-[13px] text-ink">{value}</span>
        {note && <span className="ml-1.5 font-mono text-[11px] text-ink-3">{note}</span>}
      </dd>
    </div>
  )
}

export function Offering({ offering: o, onBack }: { offering: TOffering; onBack: () => void }) {
  const [amount, setAmount] = useState('')
  const hardCap = hardCapOf(o)
  const pct = Math.min(100, (o.raised / hardCap) * 100)
  const softMet = o.raised >= o.softCap
  const ethIn = Math.max(0, parseFloat(amount) || 0)
  const tokensOut = ethIn / o.priceEth
  const remaining = o.walletCap > 0 ? Math.max(0, o.walletCap - o.yourEth) : Infinity
  const willRefund = ethIn > remaining
  const liqPct = o.liquidityBps / 100
  const issuerProceeds = hardCap * (1 - o.liquidityBps / 10000 - protocolFeeBps / 10000)

  return (
    <main className="py-7">
      <button onClick={onBack} className="cursor-pointer font-mono text-[12px] uppercase tracking-[0.12em] text-ink-3 transition hover:text-ink">
        ← Board
      </button>

      {/* header */}
      <div className="mt-5 flex flex-wrap items-start gap-4 border-b border-rule pb-6">
        <Mark ticker={o.ticker} size={52} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-serif text-[26px] font-semibold leading-tight tracking-[-0.01em]">{o.name}</h1>
            <span className="font-mono text-[13px] text-ink-3">{o.ticker}</span>
            <StatusTag status={o.status} />
          </div>
          <p className="mt-1.5 max-w-xl text-[14px] leading-relaxed text-ink-2">{o.purpose}</p>
          <p className="mt-1 font-mono text-[11px] text-ink-3">issued by {o.issuer}</p>
        </div>
      </div>

      <div className="mt-7 grid gap-7 lg:grid-cols-[1fr_352px]">
        {/* left: the prospectus */}
        <div>
          {/* subscription */}
          <section>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-mono text-[14px] text-ink-2">
                <span className="tnum font-serif text-[24px] font-semibold text-ink">{eth(o.raised)}</span>
                <span className="tnum"> / {eth(hardCap)} ETH subscribed</span>
              </p>
              <p className="font-mono text-[12px] text-ink-2">
                <span className="tnum">{o.subscribers.toLocaleString()}</span> subscribers
              </p>
            </div>
            <div className="mt-3">
              <Meter offering={o} height={8} />
            </div>
            <div className="mt-2 flex justify-between font-mono text-[11px]">
              <span className={softMet ? 'text-pos' : 'text-ink-2'}>
                soft cap {eth(o.softCap)} ETH {softMet ? '· cleared' : '· not yet met'}
              </span>
              <span className="tnum text-ink-2">{pct.toFixed(1)}% of hard cap</span>
            </div>
          </section>

          {/* the par thesis, applied to this offering */}
          <section className="mt-7 flex items-center gap-5 rounded-[8px] bg-surface px-5 py-4 ring-1 ring-rule">
            <ParLine width={120} height={50} />
            <p className="text-[13px] leading-relaxed text-ink-2">
              One price for the whole sale:{' '}
              <span className="font-mono text-ink">{par(o.priceEth)} ETH</span> per {o.ticker}. Being early earns no
              discount, so there is no curve to front-run and no instant arbitrage at listing.
            </p>
          </section>

          {/* term sheet */}
          <section className="mt-7">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">Terms</h2>
            <dl className="mt-2">
              <Term label="Par price" value={`${par(o.priceEth)} ETH`} note="flat · all buyers" />
              <Term label="Tokens offered" value={compact(o.forSale)} note={o.ticker} />
              <Term label="Paired to liquidity" value={compact(o.forLiquidity)} note={o.ticker} />
              <Term label="Total supply" value={compact(o.forSale + o.forLiquidity)} note={o.ticker} />
              <Term label="Hard cap" value={`${eth(hardCap)} ETH`} />
              <Term label="Soft cap" value={`${eth(o.softCap)} ETH`} />
              <Term label="Per-wallet cap" value={o.walletCap ? `${eth(o.walletCap)} ETH` : 'None'} />
              <Term label="Raise into liquidity" value={`${liqPct}%`} note="LP burned" />
              <Term label="Uniswap listing price" value={`${par(o.priceEth)} ETH`} note="= par price" />
              <Term label="Protocol fee" value={`${protocolFeeBps / 100}%`} note="of the raise" />
            </dl>
          </section>

          {/* settlement */}
          <section className="mt-7">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">Settlement</h2>
            <ol className="mt-3 space-y-3 text-[13px] leading-relaxed text-ink-2">
              <li className="flex gap-3">
                <span className="font-mono text-accent">1</span>
                <span>
                  Subscribers send ETH while the offering is open. Anything over the hard cap or a wallet cap is
                  returned in the same transaction.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="font-mono text-accent">2</span>
                <span>
                  Soft cap cleared: {liqPct}% of the raise plus a matching share of reserve tokens are added to the
                  Uniswap pool at the par price, the LP tokens are burned, unsold tokens are destroyed, and the
                  issuer receives the rest.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="font-mono text-accent">3</span>
                <span>Soft cap missed: the offering is cancelled and every subscriber withdraws their full ETH.</span>
              </li>
            </ol>
          </section>
        </div>

        {/* right: action panel */}
        <aside className="h-fit rounded-[10px] bg-surface p-5 ring-1 ring-rule lg:sticky lg:top-5">
          {o.status === 'open' && (
            <>
              <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">Subscribe</h2>

              <label className="mt-3 block rounded-[8px] bg-paper px-4 py-3 ring-1 ring-rule focus-within:ring-ink">
                <span className="flex justify-between font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">
                  <span>You pay</span>
                  <span className="tnum">balance {eth(WALLET.balanceEth)} ETH</span>
                </span>
                <span className="mt-1 flex items-center gap-2">
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.0"
                    inputMode="decimal"
                    className="tnum w-full bg-transparent font-mono text-[26px] font-semibold text-ink outline-none placeholder:text-ink-3/60"
                  />
                  <span className="font-mono text-[14px] font-semibold text-ink-2">ETH</span>
                </span>
              </label>

              <div className="my-2 flex items-center gap-3 px-1">
                <span className="h-px flex-1 bg-rule" />
                <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">at par {par(o.priceEth)} ETH</span>
                <span className="h-px flex-1 bg-rule" />
              </div>

              <div className="rounded-[8px] bg-paper px-4 py-3 ring-1 ring-rule">
                <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">You receive</span>
                <p className="tnum mt-1 font-mono text-[26px] font-semibold text-ink">
                  {tokensOut ? tokens(tokensOut) : '0'} <span className="text-[14px] text-ink-2">{o.ticker}</span>
                </p>
              </div>

              <button
                disabled={!ethIn}
                className="mt-4 w-full cursor-pointer rounded-[8px] bg-ink py-3 font-mono text-[12px] uppercase tracking-[0.1em] text-paper transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-rule-2 disabled:text-ink-3"
              >
                {ethIn ? `Subscribe for ${eth(ethIn)} ETH` : 'Enter an amount'}
              </button>

              <p className="mt-2.5 text-[11px] leading-relaxed text-ink-3">
                {willRefund && o.walletCap > 0
                  ? `Your wallet cap leaves ${eth(remaining)} ETH of room. The rest is refunded in the same transaction.`
                  : 'Same price as every other subscriber. Overpayment past any cap is refunded automatically.'}
              </p>

              {o.yourEth > 0 && (
                <div className="mt-4 rounded-[8px] bg-paper-2 px-4 py-3 ring-1 ring-rule">
                  <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">Your position</span>
                  <p className="tnum mt-1 font-mono text-[13px] text-ink">
                    {eth(o.yourEth)} ETH → {tokens(o.yourTokens)} {o.ticker}
                  </p>
                </div>
              )}
            </>
          )}

          {o.status === 'scheduled' && (
            <div className="text-center">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">Opens in</h2>
              <p className="tnum mt-2 font-serif text-[30px] font-semibold">{o.opensIn}</p>
              <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
                The price is fixed at {par(o.priceEth)} ETH per {o.ticker}. There is no advantage to being first, so
                subscribe whenever the window opens.
              </p>
              <button className="mt-5 w-full cursor-pointer rounded-[8px] bg-paper py-3 font-mono text-[12px] uppercase tracking-[0.1em] text-ink ring-1 ring-rule-2 transition hover:ring-ink">
                Notify me at open
              </button>
            </div>
          )}

          {o.status === 'funded' && (
            <div className="text-center">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-pos">Settled · LP burned</h2>
              <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
                The soft cap cleared, liquidity is live on Uniswap, and the LP tokens are burned. Claim your
                allocation below.
              </p>
              <div className="mt-4 rounded-[8px] bg-paper px-4 py-3 text-left ring-1 ring-rule">
                <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">Claimable</span>
                <p className="tnum mt-1 font-mono text-[24px] font-semibold text-ink">
                  {tokens(o.yourTokens)} <span className="text-[13px] text-ink-2">{o.ticker}</span>
                </p>
              </div>
              <button
                disabled={!o.yourTokens}
                className="mt-4 w-full cursor-pointer rounded-[8px] bg-ink py-3 font-mono text-[12px] uppercase tracking-[0.1em] text-paper transition hover:opacity-90 disabled:bg-rule-2 disabled:text-ink-3"
              >
                {o.yourTokens ? 'Claim tokens' : 'Nothing to claim'}
              </button>
            </div>
          )}

          {o.status === 'refunding' && (
            <div className="text-center">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-neg">Soft cap missed</h2>
              <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
                This offering was cancelled because it did not reach {eth(o.softCap)} ETH. Every subscriber can
                withdraw their full contribution.
              </p>
              <div className="mt-4 rounded-[8px] bg-paper px-4 py-3 text-left ring-1 ring-rule">
                <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">Your refund</span>
                <p className="tnum mt-1 font-mono text-[24px] font-semibold text-ink">
                  {eth(o.yourEth)} <span className="text-[13px] text-ink-2">ETH</span>
                </p>
              </div>
              <button
                disabled={!o.yourEth}
                className="mt-4 w-full cursor-pointer rounded-[8px] py-3 font-mono text-[12px] uppercase tracking-[0.1em] text-paper transition hover:opacity-90 disabled:bg-rule-2 disabled:text-ink-3"
                style={o.yourEth ? { background: 'var(--color-neg)' } : undefined}
              >
                {o.yourEth ? 'Withdraw ETH' : 'Nothing to withdraw'}
              </button>
            </div>
          )}

          {/* issuer proceeds note, shown where relevant */}
          {(o.status === 'open' || o.status === 'scheduled') && (
            <p className="mt-4 border-t border-rule pt-3 font-mono text-[10px] leading-relaxed text-ink-3">
              On a full raise the issuer nets ≤ {eth(issuerProceeds)} ETH after liquidity and fee.
            </p>
          )}
        </aside>
      </div>
    </main>
  )
}
