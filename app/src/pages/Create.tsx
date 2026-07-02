import { useState } from 'react'
import { compact } from '../data/launches'
import { SplitMeter } from '../components/SplitMeter'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between">
        <span className="text-[13px] font-medium text-ink">{label}</span>
        {hint && <span className="text-[11px] text-ink-3">{hint}</span>}
      </span>
      <span className="mt-2 block">{children}</span>
    </label>
  )
}

const inputCls =
  'tnum w-full rounded-lg border border-line bg-paper px-3.5 py-2.5 text-sm text-ink outline-none transition placeholder:text-ink-3/50 focus:border-line-2'

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-line pt-7">
      <div className="flex items-center gap-2.5">
        <span className="tnum text-[12px] font-semibold text-ink-3">{n}</span>
        <h2 className="font-display text-[16px] font-semibold tracking-tight">{title}</h2>
      </div>
      <div className="mt-4">{children}</div>
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
    <main className="rise-in py-10">
      <button onClick={onBack} className="cursor-pointer text-[13px] text-ink-3 transition hover:text-ink">
        ← All launches
      </button>

      <div className="mt-6 grid gap-12 lg:grid-cols-[1fr_336px]">
        <div>
          <h1 className="font-display text-[32px] font-semibold tracking-tight">Launch a token</h1>
          <p className="mt-2 max-w-lg text-[15px] leading-relaxed text-ink-2">
            One flat price for the whole sale. The full supply mints to the launchpad, the LP burns on
            graduation, and the trade fee splits 50/50 forever after. You never hold unsold tokens.
          </p>

          <div className="mt-9 space-y-8">
            <Section n="01" title="Token">
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Name">
                  <input className={inputCls} placeholder="Greenwood" value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field label="Symbol">
                  <input className={inputCls} placeholder="GWD" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
                </Field>
              </div>
            </Section>

            <Section n="02" title="Pricing & supply">
              <div className="grid gap-5 sm:grid-cols-3">
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
              <p className="tnum mt-3 text-[12px] text-ink-3">
                Hard cap = {compact(sale)} × {p || '…'} = <span className="font-medium text-ink">{compact(hardCap)} RBH</span>
              </p>
            </Section>

            <Section n="03" title="Caps & window">
              <div className="grid gap-5 sm:grid-cols-3">
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
                  <span className="flex items-center gap-2">
                    {[1, 3, 7].map((d) => (
                      <button
                        key={d}
                        onClick={() => setDays(d)}
                        className={`tnum flex-1 cursor-pointer rounded-lg border py-2.5 text-sm transition ${
                          days === d ? 'border-ink bg-ink text-paper' : 'border-line bg-paper text-ink-2 hover:border-line-2'
                        }`}
                      >
                        {d}d
                      </button>
                    ))}
                  </span>
                </Field>
              </div>
              {soft > 0 && !softOk && (
                <p className="mt-3 text-[12px] text-clay">Soft cap must be at most the hard cap ({compact(hardCap)} RBH).</p>
              )}
            </Section>

            <Section n="04" title="Liquidity">
              <Field label={`Share of raise into the pool — ${liquidityPct}%`} hint="minimum 50% · LP burned">
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
                <span>50% · floor</span>
                <span>100% · fair-launch</span>
              </div>
            </Section>

            <Section n="05" title="The split">
              <Field label={`Trade fee — ${feePct}%`} hint="charged on every swap after graduation">
                <input
                  type="range"
                  min={0.5}
                  max={5}
                  step={0.5}
                  value={feePct}
                  onChange={(e) => setFeePct(parseFloat(e.target.value))}
                  className="w-full accent-(--color-gold)"
                />
              </Field>
              <div className="tnum mt-2 flex justify-between text-[11px] text-ink-3">
                <span>0.5% · light</span>
                <span>5% · max</span>
              </div>
              <p className="mt-4 text-[13px] leading-relaxed text-ink-2">
                The 50/50 is fixed — you set the size of the fee, not who gets it. On a sample 1M RBH of volume,
                a {feePct}% fee splits like this:
              </p>
              <div className="mt-4">
                <SplitMeter toHolders={samplePool / 2} toTraders={samplePool / 2} compactMode />
              </div>
            </Section>
          </div>
        </div>

        {/* summary panel */}
        <aside className="h-fit rounded-2xl border border-line bg-surface p-5 lg:sticky lg:top-6">
          <h2 className="text-[13px] font-semibold text-ink">Launch summary</h2>
          <dl className="mt-4 divide-y divide-line text-[13px]">
            {[
              ['Token', name && symbol ? `${name} · ${symbol}` : '—'],
              ['Sale price', p ? `${p} RBH · flat` : '—'],
              ['Hard cap', hardCap ? `${compact(hardCap)} RBH` : '—'],
              ['Soft cap', soft ? `${compact(soft)} RBH` : '—'],
              ['Supply', sale + liq ? `${compact(sale + liq)}` : '—'],
              ['Into liquidity', `${liquidityPct}% of raise`],
              ['Trade fee', `${feePct}% · split 50/50`],
              ['Chain', 'Robinhood · 4663'],
            ].map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-3 py-2.5">
                <dt className="text-ink-3">{k}</dt>
                <dd className="tnum text-right font-medium text-ink">{v}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-4 text-[12px] leading-relaxed text-ink-2">
            The split is hard-coded 50/50 and can't be changed after launch — holders and traders each keep
            their half no matter what. That's what makes it credible.
          </p>

          <button
            disabled={!name || !symbol || !p || !softOk}
            className="mt-5 w-full cursor-pointer rounded-lg bg-ink py-3 text-sm font-medium text-paper transition hover:bg-emerald-strong disabled:cursor-not-allowed disabled:bg-panel disabled:text-ink-3"
          >
            Deploy launch
          </button>
          <p className="mt-2.5 text-center text-[11px] text-ink-3">One transaction · deploys token + opens sale</p>
        </aside>
      </div>
    </main>
  )
}
