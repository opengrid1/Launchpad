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
  'tnum w-full border-b border-line-2 bg-transparent pb-2 text-[15px] text-ink outline-none transition-colors placeholder:text-ink-3/40 focus:border-emerald'

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div className="rule-t pt-7">
      <div className="flex items-baseline gap-3">
        <span className="font-display text-[18px] leading-none text-emerald-strong">{n}</span>
        <h2 className="font-display text-[20px] font-medium tracking-tight">{title}</h2>
      </div>
      <div className="mt-5">{children}</div>
    </div>
  )
}

export function Create({ onBack }: { onBack: () => void }) {
  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [priceRbh, setPriceRbh] = useState('0.001')
  const [forSale, setForSale] = useState('100000000')
  const [forLiquidity, setForLiquidity] = useState('80000000')
  const [softCap, setSoftCap] = useState('40000')
  const [liquidityPct, setLiquidityPct] = useState(70)
  const [walletCap, setWalletCap] = useState('')
  const [days, setDays] = useState(3)
  const [feePct, setFeePct] = useState(2)

  const p = parseFloat(priceRbh) || 0
  const sale = parseFloat(forSale) || 0
  const liq = parseFloat(forLiquidity) || 0
  const soft = parseFloat(softCap) || 0
  const hardCap = p * sale
  const softOk = soft > 0 && soft <= hardCap
  const samplePool = (1_000_000 * feePct) / 100

  return (
    <main className="rise-in py-8">
      <button onClick={onBack} className="text-[13px] text-ink-2 transition-colors hover:text-ink">
        ← All launches
      </button>

      <div className="mt-8 grid gap-x-14 gap-y-10 lg:grid-cols-[1fr_320px]">
        <div>
          <h1 className="font-display text-[40px] font-medium leading-none tracking-tight">Start a launch</h1>
          <p className="mt-4 max-w-lg text-[16px] leading-relaxed text-ink-2">
            One flat price for the whole sale. The full supply mints to the launchpad, the LP burns on
            graduation, and the trade fee splits 50/50 forever after. You never hold unsold tokens.
          </p>

          <div className="mt-10 space-y-9">
            <Section n="1" title="The token">
              <div className="grid gap-6 sm:grid-cols-2">
                <Field label="Name">
                  <input className={inputCls} placeholder="Greenwood" value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field label="Symbol">
                  <input className={inputCls} placeholder="GWD" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
                </Field>
              </div>
            </Section>

            <Section n="2" title="Price & supply">
              <div className="grid gap-6 sm:grid-cols-3">
                <Field label="Price" hint="RBH per token">
                  <input className={inputCls} value={priceRbh} onChange={(e) => setPriceRbh(e.target.value)} inputMode="decimal" />
                </Field>
                <Field label="Tokens for sale">
                  <input className={inputCls} value={forSale} onChange={(e) => setForSale(e.target.value)} inputMode="numeric" />
                </Field>
                <Field label="Tokens for liquidity">
                  <input className={inputCls} value={forLiquidity} onChange={(e) => setForLiquidity(e.target.value)} inputMode="numeric" />
                </Field>
              </div>
              <p className="tnum mt-4 text-[13px] text-ink-3">
                Hard cap: {compact(sale)} × {p || '…'} = <span className="text-ink">{compact(hardCap)} RBH</span>
              </p>
            </Section>

            <Section n="3" title="Caps & window">
              <div className="grid gap-6 sm:grid-cols-3">
                <Field label="Soft cap" hint="RBH">
                  <input
                    className={`${inputCls} ${soft && !softOk ? 'border-clay' : ''}`}
                    value={softCap}
                    onChange={(e) => setSoftCap(e.target.value)}
                    inputMode="numeric"
                  />
                </Field>
                <Field label="Wallet cap" hint="blank = none">
                  <input className={inputCls} placeholder="unlimited" value={walletCap} onChange={(e) => setWalletCap(e.target.value)} inputMode="numeric" />
                </Field>
                <Field label="Duration">
                  <span className="flex items-center gap-4 pb-1">
                    {[1, 3, 7].map((d) => (
                      <button
                        key={d}
                        onClick={() => setDays(d)}
                        className={`tnum cursor-pointer text-[15px] transition-colors ${
                          days === d ? 'text-emerald-strong underline decoration-emerald underline-offset-4' : 'text-ink-3 hover:text-ink'
                        }`}
                      >
                        {d}d
                      </button>
                    ))}
                  </span>
                </Field>
              </div>
              {soft > 0 && !softOk && (
                <p className="mt-4 text-[12px] text-clay">Soft cap must be at most the hard cap ({compact(hardCap)} RBH).</p>
              )}
            </Section>

            <Section n="4" title="Liquidity">
              <Field label={`Share of raise into the pool · ${liquidityPct}%`} hint="minimum 50% · LP burned">
                <input
                  type="range"
                  min={50}
                  max={100}
                  value={liquidityPct}
                  onChange={(e) => setLiquidityPct(parseInt(e.target.value))}
                  className="w-full accent-(--color-emerald)"
                />
              </Field>
              <div className="tnum mt-2 flex justify-between text-[11px] text-ink-3">
                <span>50% floor</span>
                <span>100% fair-launch</span>
              </div>
            </Section>

            <Section n="5" title="The split">
              <Field label={`Trade fee · ${feePct}%`} hint="charged on every swap after graduation">
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
              <p className="mt-5 max-w-lg text-[14px] leading-relaxed text-ink-2">
                The 50/50 is fixed. You set the size of the fee, not who gets it. On a sample 1M RBH of volume,
                a {feePct}% fee splits like this:
              </p>
              <div className="mt-5 max-w-md">
                <SplitMeter toHolders={samplePool / 2} toTraders={samplePool / 2} compactMode />
              </div>
            </Section>
          </div>
        </div>

        {/* manifest */}
        <aside className="h-fit rounded-2xl bg-surface p-6 lg:sticky lg:top-6">
          <p className="eyebrow">Your launch, so far</p>
          <dl className="mt-4 space-y-3">
            {[
              ['Token', name && symbol ? symbol : '·'],
              ['Price', p ? `${p} RBH` : '·'],
              ['Hard cap', hardCap ? `${compact(hardCap)} RBH` : '·'],
              ['Soft cap', soft ? `${compact(soft)} RBH` : '·'],
              ['Supply', sale + liq ? compact(sale + liq) : '·'],
              ['Liquidity', `${liquidityPct}%`],
              ['Fee', `${feePct}% · 50/50`],
            ].map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-3">
                <dt className="text-[13px] text-ink-2">{k}</dt>
                <dd className="tnum text-[13px] text-ink">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-6 border-t border-line pt-4 text-[12px] leading-relaxed text-ink-3">
            The 50/50 is hard-coded and can't change after launch. Holders and traders each keep their half
            no matter what. That is what makes it worth trusting.
          </p>
          <button
            disabled={!name || !symbol || !p || !softOk}
            className="mt-5 w-full cursor-pointer rounded-full bg-ink py-3 text-[14px] font-medium text-paper transition hover:bg-emerald-strong disabled:cursor-not-allowed disabled:bg-panel disabled:text-ink-3"
          >
            Deploy launch
          </button>
          <p className="eyebrow mt-3 text-center">One transaction · token + sale</p>
        </aside>
      </div>
    </main>
  )
}
