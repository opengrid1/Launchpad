import { useState } from 'react'
import { compact } from '../data/launches'
import { SplitMeter } from '../components/SplitMeter'

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between">
        <span className="text-[13px] font-semibold text-parch-100">{label}</span>
        {hint && <span className="text-[11px] text-sage-500">{hint}</span>}
      </span>
      <span className="mt-1.5 block">{children}</span>
    </label>
  )
}

const inputCls =
  'w-full rounded-xl bg-pine-850 px-3.5 py-2.5 font-mono text-sm text-parch-100 ring-1 ring-pine-700 outline-none transition placeholder:text-sage-500/50 focus:ring-moss-500/60'

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

  // illustrative: what a hypothetical 1M RBH of lifetime volume would throw off
  const samplePool = (1_000_000 * feePct) / 100

  return (
    <main className="rise-in mt-6">
      <button onClick={onBack} className="cursor-pointer text-sm text-sage-500 transition hover:text-moss-300">
        ← All launches
      </button>

      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_340px]">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Launch a token</h1>
          <p className="mt-1.5 max-w-lg text-[14px] leading-relaxed text-sage-300">
            One flat price for the whole sale. The full supply mints straight to the launchpad, the LP burns
            on graduation, and the trade fee splits 50/50 forever after. You never hold unsold tokens.
          </p>

          <section className="mt-7 space-y-7">
            <div className="rounded-2xl bg-pine-900 p-5 ring-1 ring-pine-700">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-moss-400">01 · Token</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="Name">
                  <input className={inputCls} placeholder="Greenwood" value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field label="Symbol">
                  <input className={inputCls} placeholder="GWD" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
                </Field>
              </div>
            </div>

            <div className="rounded-2xl bg-pine-900 p-5 ring-1 ring-pine-700">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-moss-400">02 · Pricing & supply</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
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
              <p className="mt-3 font-mono text-[12px] text-sage-500">
                Hard cap = {compact(sale)} × {p || '…'} = <span className="text-parch-100">{compact(hardCap)} RBH</span>
              </p>
            </div>

            <div className="rounded-2xl bg-pine-900 p-5 ring-1 ring-pine-700">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-moss-400">03 · Caps & window</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <Field label="Soft cap" hint="RBH">
                  <input
                    className={`${inputCls} ${soft && !softOk ? 'ring-clay-400/60' : ''}`}
                    value={softCap}
                    onChange={(e) => setSoftCap(e.target.value)}
                    inputMode="numeric"
                  />
                </Field>
                <Field label="Wallet cap" hint="RBH · blank = none">
                  <input className={inputCls} placeholder="unlimited" value={walletCap} onChange={(e) => setWalletCap(e.target.value)} inputMode="numeric" />
                </Field>
                <Field label="Duration">
                  <span className="flex items-center gap-2">
                    {[1, 3, 7].map((d) => (
                      <button
                        key={d}
                        onClick={() => setDays(d)}
                        className={`flex-1 cursor-pointer rounded-xl py-2.5 font-mono text-sm ring-1 transition ${
                          days === d
                            ? 'bg-moss-500/15 text-moss-300 ring-moss-500/40'
                            : 'bg-pine-850 text-sage-300 ring-pine-700 hover:text-parch-100'
                        }`}
                      >
                        {d}d
                      </button>
                    ))}
                  </span>
                </Field>
              </div>
              {soft > 0 && !softOk && (
                <p className="mt-3 text-[12px] text-clay-400">Soft cap must be at most the hard cap ({compact(hardCap)} RBH).</p>
              )}
            </div>

            <div className="rounded-2xl bg-pine-900 p-5 ring-1 ring-pine-700">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-moss-400">04 · Liquidity</h2>
              <Field label={`Share of raise into the pool — ${liquidityPct}%`} hint="minimum 50% · LP burned">
                <input
                  type="range"
                  min={50}
                  max={100}
                  value={liquidityPct}
                  onChange={(e) => setLiquidityPct(parseInt(e.target.value))}
                  className="w-full accent-(--color-moss-400)"
                />
              </Field>
              <div className="mt-2 flex justify-between font-mono text-[11px] text-sage-500">
                <span>50% · floor</span>
                <span>100% · fair-launch mode</span>
              </div>
            </div>

            {/* the reward engine — the part that makes it a Sherwood token */}
            <div className="rounded-2xl bg-pine-900 p-5 ring-1 ring-pine-700">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-moss-400">05 · The split</h2>
              <Field label={`Trade fee — ${feePct}%`} hint="charged on every swap after graduation">
                <input
                  type="range"
                  min={0.5}
                  max={5}
                  step={0.5}
                  value={feePct}
                  onChange={(e) => setFeePct(parseFloat(e.target.value))}
                  className="w-full accent-(--color-gold-400)"
                />
              </Field>
              <div className="mt-1 flex justify-between font-mono text-[11px] text-sage-500">
                <span>0.5% · light touch</span>
                <span>5% · max</span>
              </div>
              <p className="mt-4 text-[12px] leading-relaxed text-sage-300">
                The 50/50 is fixed — you set how big the fee is, not who gets it. Half always goes to holders,
                half always back to the trader. Here's a {feePct}% fee on a sample 1M RBH of volume:
              </p>
              <div className="mt-4">
                <SplitMeter toHolders={samplePool / 2} toTraders={samplePool / 2} compactMode />
              </div>
            </div>
          </section>
        </div>

        {/* summary panel */}
        <aside className="h-fit rounded-2xl bg-pine-900 p-5 ring-1 ring-pine-700 lg:sticky lg:top-6">
          <h2 className="text-sm font-semibold">Launch summary</h2>
          <dl className="mt-4 space-y-3 text-[13px]">
            {[
              ['Token', name && symbol ? `${name} ($${symbol})` : '—'],
              ['Sale price', p ? `${p} RBH · flat` : '—'],
              ['Hard cap', hardCap ? `${compact(hardCap)} RBH` : '—'],
              ['Soft cap', soft ? `${compact(soft)} RBH` : '—'],
              ['Supply', sale + liq ? `${compact(sale + liq)} (${compact(sale)} sale / ${compact(liq)} LP)` : '—'],
              ['Into liquidity', `${liquidityPct}% of raise`],
              ['Trade fee', `${feePct}% · split 50/50`],
              ['Chain', 'Robinhood · 4663'],
            ].map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-3">
                <dt className="text-sage-500">{k}</dt>
                <dd className="text-right font-mono text-parch-100">{v}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-5 rounded-xl bg-gold-400/8 p-3.5 text-[12px] leading-relaxed text-sage-300 ring-1 ring-gold-400/20">
            The split is hard-coded 50/50 and can't be changed after launch — holders and traders each keep
            their half no matter what you do next. That's what makes it credible.
          </div>

          <button
            disabled={!name || !symbol || !p || !softOk}
            className="mt-5 w-full cursor-pointer rounded-xl bg-moss-500 py-3 text-sm font-bold text-pine-950 transition hover:bg-moss-400 disabled:cursor-not-allowed disabled:bg-pine-700 disabled:text-sage-500"
          >
            Deploy launch
          </button>
          <p className="mt-2.5 text-center text-[11px] text-sage-500">One transaction · deploys token + opens sale</p>
        </aside>
      </div>
    </main>
  )
}
