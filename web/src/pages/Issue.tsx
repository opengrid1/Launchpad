import { useState } from 'react'
import { compact, eth, par, protocolFeeBps } from '../data/offerings'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between">
        <span className="text-[13px] font-medium text-ink">{label}</span>
        {hint && <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">{hint}</span>}
      </span>
      <span className="mt-1.5 block">{children}</span>
    </label>
  )
}

const input =
  'w-full rounded-[7px] bg-paper px-3 py-2.5 font-mono text-[13px] text-ink ring-1 ring-rule outline-none transition placeholder:text-ink-3/60 focus:ring-ink tnum'

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-rule pt-6">
      <h2 className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
        <span className="text-accent">{n}</span>
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  )
}

export function Issue({ onBack }: { onBack: () => void }) {
  const [name, setName] = useState('')
  const [ticker, setTicker] = useState('')
  const [price, setPrice] = useState('0.0001')
  const [forSale, setForSale] = useState('4000000')
  const [forLiquidity, setForLiquidity] = useState('3000000')
  const [softCap, setSoftCap] = useState('180')
  const [walletCap, setWalletCap] = useState('')
  const [liqPct, setLiqPct] = useState(70)
  const [days, setDays] = useState(3)

  const p = parseFloat(price) || 0
  const sale = parseFloat(forSale) || 0
  const liq = parseFloat(forLiquidity) || 0
  const soft = parseFloat(softCap) || 0
  const hardCap = p * sale
  const softOk = soft > 0 && soft <= hardCap
  const ready = name.trim() && ticker.trim() && p > 0 && sale > 0 && softOk
  const proceeds = hardCap * (1 - liqPct / 100 - protocolFeeBps / 10000)

  const rows: [string, string][] = [
    ['Token', name && ticker ? `${name} · ${ticker}` : '—'],
    ['Par price', p ? `${par(p)} ETH` : '—'],
    ['Hard cap', hardCap ? `${eth(hardCap)} ETH` : '—'],
    ['Soft cap', soft ? `${eth(soft)} ETH` : '—'],
    ['Supply', sale + liq ? `${compact(sale + liq)}` : '—'],
    ['Offered / to LP', sale + liq ? `${compact(sale)} / ${compact(liq)}` : '—'],
    ['Into liquidity', `${liqPct}% of raise`],
    ['Listing price', p ? `${par(p)} ETH` : '—'],
    ['Protocol fee', `${protocolFeeBps / 100}%`],
    ['Window', `${days} day${days > 1 ? 's' : ''}`],
    ['Issuer nets ≤', hardCap ? `${eth(proceeds)} ETH` : '—'],
  ]

  return (
    <main className="py-7">
      <button onClick={onBack} className="cursor-pointer font-mono text-[12px] uppercase tracking-[0.12em] text-ink-3 transition hover:text-ink">
        ← Board
      </button>

      <div className="mt-5 grid gap-8 lg:grid-cols-[1fr_320px]">
        <div>
          <h1 className="font-serif text-[28px] font-semibold leading-tight tracking-[-0.01em]">Issue an offering</h1>
          <p className="mt-2 max-w-lg text-[14px] leading-relaxed text-ink-2">
            Set one par price for the entire sale. The full supply mints straight to the contract, so you never
            custody unsold tokens, and the LP is burned the moment the soft cap clears.
          </p>

          <div className="mt-7 space-y-6">
            <Section n="01" title="Token">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name">
                  <input className={input} placeholder="Meridian" value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field label="Ticker">
                  <input
                    className={input}
                    placeholder="MRD"
                    value={ticker}
                    maxLength={8}
                    onChange={(e) => setTicker(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                  />
                </Field>
              </div>
            </Section>

            <Section n="02" title="Price & supply">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Par price" hint="ETH / token">
                  <input className={input} value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" />
                </Field>
                <Field label="Tokens offered">
                  <input className={input} value={forSale} onChange={(e) => setForSale(e.target.value)} inputMode="numeric" />
                </Field>
                <Field label="Tokens to LP">
                  <input className={input} value={forLiquidity} onChange={(e) => setForLiquidity(e.target.value)} inputMode="numeric" />
                </Field>
              </div>
              <p className="mt-3 font-mono text-[12px] text-ink-2">
                Hard cap = {compact(sale)} × {p || '—'} ={' '}
                <span className="tnum text-ink">{hardCap ? `${eth(hardCap)} ETH` : '—'}</span>
              </p>
            </Section>

            <Section n="03" title="Caps & window">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Soft cap" hint="ETH">
                  <input
                    className={`${input} ${soft > 0 && !softOk ? 'ring-neg' : ''}`}
                    value={softCap}
                    onChange={(e) => setSoftCap(e.target.value)}
                    inputMode="numeric"
                  />
                </Field>
                <Field label="Wallet cap" hint="ETH · blank = none">
                  <input className={input} placeholder="none" value={walletCap} onChange={(e) => setWalletCap(e.target.value)} inputMode="numeric" />
                </Field>
                <Field label="Duration">
                  <span className="flex gap-1.5">
                    {[1, 3, 7].map((d) => (
                      <button
                        key={d}
                        onClick={() => setDays(d)}
                        className={`flex-1 cursor-pointer rounded-[7px] py-2.5 font-mono text-[13px] ring-1 transition ${
                          days === d ? 'bg-ink text-paper ring-ink' : 'bg-paper text-ink-2 ring-rule hover:ring-ink'
                        }`}
                      >
                        {d}d
                      </button>
                    ))}
                  </span>
                </Field>
              </div>
              {soft > 0 && !softOk && (
                <p className="mt-3 font-mono text-[12px] text-neg">Soft cap must be between 0 and the hard cap ({eth(hardCap)} ETH).</p>
              )}
            </Section>

            <Section n="04" title="Liquidity">
              <Field label={`Share of the raise paired into Uniswap — ${liqPct}%`} hint="min 50% · LP burned">
                <input type="range" min={50} max={100} value={liqPct} onChange={(e) => setLiqPct(parseInt(e.target.value))} className="w-full" />
              </Field>
              <div className="mt-2 flex justify-between font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">
                <span>50% · floor</span>
                <span>100% · no proceeds</span>
              </div>
              <p className="mt-3 text-[12px] leading-relaxed text-ink-2">
                Pool tokens scale with how much of the sale fills, so the Uniswap pair always lists at exactly the par
                price. A partial fill cannot be instantly arbitraged against your subscribers.
              </p>
            </Section>
          </div>
        </div>

        {/* live prospectus preview */}
        <aside className="h-fit lg:sticky lg:top-5">
          <div className="rounded-[10px] bg-surface p-5 ring-1 ring-rule">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">Prospectus preview</h2>
            <dl className="mt-3">
              {rows.map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-4 border-b border-rule py-2 last:border-0">
                  <dt className="text-[12px] text-ink-2">{k}</dt>
                  <dd className="tnum text-right font-mono text-[12px] text-ink">{v}</dd>
                </div>
              ))}
            </dl>

            <button
              disabled={!ready}
              className="mt-5 w-full cursor-pointer rounded-[8px] bg-ink py-3 font-mono text-[12px] uppercase tracking-[0.1em] text-paper transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-rule-2 disabled:text-ink-3"
            >
              Publish offering
            </button>
            <p className="mt-2.5 text-center font-mono text-[10px] leading-relaxed text-ink-3">
              One transaction · deploys the token and opens the sale
            </p>
          </div>
        </aside>
      </div>
    </main>
  )
}
