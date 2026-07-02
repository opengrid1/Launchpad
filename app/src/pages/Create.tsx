import { useState } from 'react'
import { compact } from '../data/launches'
import { SplitMeter } from '../components/SplitMeter'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between">
        <span className="text-[13px] text-ink">{label}</span>
        {hint && <span className="text-[11px] text-ink-3">{hint}</span>}
      </span>
      <span className="mt-2 block">{children}</span>
    </label>
  )
}

const inputCls =
  'tnum w-full rounded-lg bg-panel px-3.5 py-2.5 text-[14px] text-ink outline-none ring-1 ring-line transition placeholder:text-ink-3/40 focus:ring-emerald/50'

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-surface p-5 ring-1 ring-line">
      <div className="flex items-baseline gap-2.5">
        <span className="tnum text-[12px] font-semibold text-emerald-strong">{n}</span>
        <h2 className="font-display text-[17px] font-bold tracking-tight">{title}</h2>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  )
}

export function Create({ onBack }: { onBack: () => void }) {
  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [priceEth, setPriceEth] = useState('0.0000005')
  const [supply, setSupply] = useState('1000000000')
  const [liquidityPct, setLiquidityPct] = useState(70)
  const [feePct, setFeePct] = useState(2)
  const [devBuy, setDevBuy] = useState('')

  const p = parseFloat(priceEth) || 0
  const sup = parseFloat(supply) || 0
  const startMcap = p * sup

  return (
    <main className="rise-in mx-auto max-w-5xl py-8">
      <button onClick={onBack} className="text-[13px] text-ink-2 transition-colors hover:text-ink">
        ← All coins
      </button>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <div>
          <h1 className="font-display text-[30px] font-extrabold leading-none tracking-tight">Create a coin</h1>
          <p className="mt-3 max-w-lg text-[14px] leading-relaxed text-ink-2">
            It goes live and starts trading against ETH right away. Liquidity locks, the LP burns, and every
            trade's tax splits 50/50 in ETH: half to holders, half to you, the creator.
          </p>

          <div className="mt-6 space-y-4">
            <Section n="01" title="Coin">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name">
                  <input className={inputCls} placeholder="Greenwood" value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field label="Ticker">
                  <input className={inputCls} placeholder="GWD" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
                </Field>
              </div>
            </Section>

            <Section n="02" title="Supply & price">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Total supply">
                  <input className={inputCls} value={supply} onChange={(e) => setSupply(e.target.value)} inputMode="numeric" />
                </Field>
                <Field label="Launch price" hint="ETH per token">
                  <input className={inputCls} value={priceEth} onChange={(e) => setPriceEth(e.target.value)} inputMode="decimal" />
                </Field>
              </div>
              <p className="tnum mt-3 text-[12px] text-ink-3">
                Starting market cap ≈ <span className="text-ink">{compact(startMcap)} ETH</span>
              </p>
            </Section>

            <Section n="03" title="Liquidity">
              <Field label={`Share of supply into the pool · ${liquidityPct}%`} hint="LP burned, locked forever">
                <input
                  type="range"
                  min={40}
                  max={100}
                  value={liquidityPct}
                  onChange={(e) => setLiquidityPct(parseInt(e.target.value))}
                  className="w-full accent-(--color-emerald)"
                />
              </Field>
              <div className="tnum mt-2 flex justify-between text-[11px] text-ink-3">
                <span>40% floor</span>
                <span>100% fair-launch</span>
              </div>
              <Field label="Your first buy" hint="optional, in ETH">
                <input className={inputCls} placeholder="0.0" value={devBuy} onChange={(e) => setDevBuy(e.target.value)} inputMode="decimal" />
              </Field>
            </Section>

            <Section n="04" title="Trade tax">
              <Field label={`Tax on every trade · ${feePct}%`} hint="collected in ETH from the pool">
                <input
                  type="range"
                  min={0.5}
                  max={5}
                  step={0.5}
                  value={feePct}
                  onChange={(e) => setFeePct(parseFloat(e.target.value))}
                  className="w-full accent-(--color-emerald)"
                />
              </Field>
              <div className="tnum mt-2 flex justify-between text-[11px] text-ink-3">
                <span>0.5% light</span>
                <span>5% max</span>
              </div>
              <p className="mt-4 text-[13px] leading-relaxed text-ink-2">
                The 50/50 is fixed. You set the size of the tax, not who gets it. On a sample 1,000 ETH of
                volume, a {feePct}% tax throws off {((1000 * feePct) / 100).toFixed(1)} ETH, split like this:
              </p>
              <div className="mt-4 max-w-md">
                <SplitMeter toHolders={(1000 * feePct) / 200} toCreator={(1000 * feePct) / 200} unit="ETH" compactMode />
              </div>
            </Section>
          </div>
        </div>

        {/* manifest */}
        <aside className="h-fit rounded-2xl bg-surface p-5 ring-1 ring-line lg:sticky lg:top-24">
          <p className="eyebrow">Your coin, so far</p>
          <dl className="mt-4 space-y-3">
            {[
              ['Ticker', name && symbol ? `$${symbol}` : '·'],
              ['Launch price', p ? `${p} ETH` : '·'],
              ['Start mcap', startMcap ? `${compact(startMcap)} ETH` : '·'],
              ['Supply', sup ? compact(sup) : '·'],
              ['Liquidity', `${liquidityPct}%`],
              ['Trade tax', `${feePct}% · 50/50`],
              ['First buy', devBuy ? `${devBuy} ETH` : 'none'],
              ['Chain', 'Robinhood'],
            ].map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-3">
                <dt className="text-[13px] text-ink-2">{k}</dt>
                <dd className="tnum text-[13px] text-ink">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-5 border-t border-line pt-4 text-[12px] leading-relaxed text-ink-3">
            The 50/50 split is hard-coded and can't change after launch. Holders and the creator each keep
            their half of the ETH tax, no matter what.
          </p>
          <button
            disabled={!name || !symbol || !p || !sup}
            className="mt-4 w-full cursor-pointer rounded-full bg-emerald py-3 text-[14px] font-semibold text-paper transition hover:bg-emerald-strong disabled:cursor-not-allowed disabled:bg-panel disabled:text-ink-3"
          >
            Launch coin
          </button>
          <p className="eyebrow mt-3 text-center">One transaction · live instantly</p>
        </aside>
      </div>
    </main>
  )
}
