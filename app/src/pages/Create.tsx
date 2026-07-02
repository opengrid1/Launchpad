import { useState } from 'react'
import { compact } from '../data/launches'
import { SplitMeter } from '../components/SplitMeter'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between">
        <span className="label">{label}</span>
        {hint && <span className="text-[10px] text-ink-3">{hint}</span>}
      </span>
      <span className="mt-2 block">{children}</span>
    </label>
  )
}

const inputCls =
  'tnum w-full border border-line bg-panel px-3 py-2 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-3/40 focus:border-emerald/50'

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div className="border border-line">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2">
        <span className="tnum text-[11px] text-emerald">{n}</span>
        <span className="label">{title}</span>
      </div>
      <div className="p-4">{children}</div>
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
      <button onClick={onBack} className="label cursor-pointer transition-colors hover:text-ink-2">
        ← BACK TO MARKETS
      </button>

      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_320px]">
        <div>
          <h1 className="font-display text-[26px] font-semibold tracking-tight">Deploy a launch</h1>
          <p className="mt-2 max-w-lg text-[13px] leading-relaxed text-ink-2">
            One flat price for the whole sale. Full supply mints to the launchpad, LP burns on graduation,
            and the trade fee splits 50/50 forever after. You never hold unsold tokens.
          </p>

          <div className="mt-7 space-y-5">
            <Section n="01" title="TOKEN">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="NAME">
                  <input className={inputCls} placeholder="Greenwood" value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field label="SYMBOL">
                  <input className={inputCls} placeholder="GWD" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
                </Field>
              </div>
            </Section>

            <Section n="02" title="PRICING & SUPPLY">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="PRICE" hint="RBH / token">
                  <input className={inputCls} value={priceRbh} onChange={(e) => setPriceRbh(e.target.value)} inputMode="decimal" />
                </Field>
                <Field label="FOR SALE">
                  <input className={inputCls} value={forSale} onChange={(e) => setForSale(e.target.value)} inputMode="numeric" />
                </Field>
                <Field label="FOR LIQUIDITY">
                  <input className={inputCls} value={forLiquidity} onChange={(e) => setForLiquidity(e.target.value)} inputMode="numeric" />
                </Field>
              </div>
              <p className="tnum mt-3 text-[11px] text-ink-3">
                &gt; HARD CAP = {compact(sale)} × {p || '…'} = <span className="text-ink">{compact(hardCap)} RBH</span>
              </p>
            </Section>

            <Section n="03" title="CAPS & WINDOW">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="SOFT CAP" hint="RBH">
                  <input
                    className={`${inputCls} ${soft && !softOk ? 'border-clay' : ''}`}
                    value={softCap}
                    onChange={(e) => setSoftCap(e.target.value)}
                    inputMode="numeric"
                  />
                </Field>
                <Field label="WALLET CAP" hint="blank = none">
                  <input className={inputCls} placeholder="unlimited" value={walletCap} onChange={(e) => setWalletCap(e.target.value)} inputMode="numeric" />
                </Field>
                <Field label="DURATION">
                  <span className="flex items-center gap-1.5">
                    {[1, 3, 7].map((d) => (
                      <button
                        key={d}
                        onClick={() => setDays(d)}
                        className={`tnum flex-1 cursor-pointer border py-2 text-[13px] transition-colors ${
                          days === d ? 'border-emerald/50 bg-emerald-tint text-emerald-strong' : 'border-line bg-panel text-ink-2 hover:border-line-2'
                        }`}
                      >
                        {d}d
                      </button>
                    ))}
                  </span>
                </Field>
              </div>
              {soft > 0 && !softOk && (
                <p className="mt-3 text-[11px] text-clay">! soft cap must be ≤ hard cap ({compact(hardCap)} RBH)</p>
              )}
            </Section>

            <Section n="04" title="LIQUIDITY">
              <Field label={`RAISE INTO POOL — ${liquidityPct}%`} hint="min 50% · LP burned">
                <input
                  type="range"
                  min={50}
                  max={100}
                  value={liquidityPct}
                  onChange={(e) => setLiquidityPct(parseInt(e.target.value))}
                  className="w-full accent-(--color-emerald)"
                />
              </Field>
              <div className="tnum mt-2 flex justify-between text-[10px] text-ink-3">
                <span>50% FLOOR</span>
                <span>100% FAIR-LAUNCH</span>
              </div>
            </Section>

            <Section n="05" title="THE SPLIT">
              <Field label={`TRADE FEE — ${feePct}%`} hint="per swap, post-graduation">
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
              <div className="tnum mt-2 flex justify-between text-[10px] text-ink-3">
                <span>0.5% LIGHT</span>
                <span>5% MAX</span>
              </div>
              <p className="mt-4 text-[12px] leading-relaxed text-ink-2">
                The 50/50 is fixed — you set the fee size, not who gets it. On a sample 1M RBH of volume,
                a {feePct}% fee splits like this:
              </p>
              <div className="mt-4">
                <SplitMeter toHolders={samplePool / 2} toTraders={samplePool / 2} compactMode />
              </div>
            </Section>
          </div>
        </div>

        {/* summary panel */}
        <aside className="h-fit border border-line lg:sticky lg:top-6">
          <div className="border-b border-line px-4 py-2">
            <span className="label">// LAUNCH MANIFEST</span>
          </div>
          <dl className="divide-y divide-line">
            {[
              ['TOKEN', name && symbol ? `${symbol}` : '—'],
              ['PRICE', p ? `${p} RBH` : '—'],
              ['HARD CAP', hardCap ? `${compact(hardCap)} RBH` : '—'],
              ['SOFT CAP', soft ? `${compact(soft)} RBH` : '—'],
              ['SUPPLY', sale + liq ? compact(sale + liq) : '—'],
              ['LIQUIDITY', `${liquidityPct}%`],
              ['FEE', `${feePct}% · 50/50`],
              ['CHAIN', '4663'],
            ].map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-3 px-4 py-2">
                <dt className="label">{k}</dt>
                <dd className="tnum text-[12px] text-ink">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="border-t border-line p-4">
            <p className="text-[10px] leading-relaxed text-ink-3">
              &gt; The 50/50 is hard-coded and immutable post-launch. Holders and traders each keep their half
              regardless. That is what makes it credible.
            </p>
            <button
              disabled={!name || !symbol || !p || !softOk}
              className="mt-4 w-full cursor-pointer border border-emerald/40 bg-emerald-tint py-2.5 text-[13px] text-emerald-strong transition-colors hover:border-emerald/70 disabled:cursor-not-allowed disabled:border-line disabled:bg-transparent disabled:text-ink-3"
            >
              [ DEPLOY LAUNCH ]
            </button>
            <p className="label mt-2 text-center">ONE TX · TOKEN + SALE</p>
          </div>
        </aside>
      </div>
    </main>
  )
}
