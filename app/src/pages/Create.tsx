import { useState } from 'react'
import { compact, type Launch } from '../data/launches'
import { SplitMeter } from '../components/SplitMeter'

const hex4 = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0')

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

export function Create({ onBack, onLaunch }: { onBack: () => void; onLaunch: (coin: Launch) => void }) {
  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [image, setImage] = useState('') // token URI (object URL of the upload)
  const [description, setDescription] = useState('')
  const [priceEth, setPriceEth] = useState('0.0000005')
  const [supply, setSupply] = useState('1000000000')
  const [liquidityPct, setLiquidityPct] = useState(70)
  const [feePct, setFeePct] = useState(2)
  const [devBuy, setDevBuy] = useState('')

  const p = parseFloat(priceEth) || 0
  const sup = parseFloat(supply) || 0
  const startMcap = p * sup
  const dev = parseFloat(devBuy) || 0
  const ready = Boolean(name && symbol && p && sup)

  function launch() {
    if (!ready) return
    const coin: Launch = {
      id: Date.now(),
      name,
      symbol,
      glyph: '🪙',
      image: image || undefined,
      tagline: description ? description.slice(0, 90) : `${name} on Sherwood.`,
      description: description || undefined,
      tokenAddress: `0x${hex4()}…${hex4()}`,
      devBuy: dev || undefined,
      priceEth: p,
      tokensForLiquidity: Math.round((sup * liquidityPct) / 100),
      tokensForSale: sup - Math.round((sup * liquidityPct) / 100),
      liquidityBps: liquidityPct * 100,
      tradeFeeBps: Math.round(feePct * 100),
      volume: dev,
      rewardsPaid: 0,
      holders: dev > 0 ? 1 : 0,
      createdAgo: 'just now',
      buyers: dev > 0 ? 1 : 0,
      status: 'live',
      creator: '0x71b3…9F02',
      yourTokens: dev > 0 ? Math.floor(dev / p) : 0,
      yourHolderRewards: 0,
      yourRebate: 0,
    }
    onLaunch(coin)
  }

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
              <div className="flex gap-4">
                {/* token image (URI) upload */}
                <label className="group relative flex h-24 w-24 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-xl bg-panel ring-1 ring-line transition hover:ring-emerald/50">
                  {image ? (
                    <img src={image} alt="token" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-center text-[11px] leading-tight text-ink-3">
                      <span className="block text-[20px]">＋</span>
                      image
                    </span>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    className="absolute inset-0 cursor-pointer opacity-0"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) setImage(URL.createObjectURL(f))
                    }}
                  />
                </label>
                <div className="grid flex-1 content-start gap-4">
                  <Field label="Name">
                    <input className={inputCls} placeholder="Greenwood" value={name} onChange={(e) => setName(e.target.value)} />
                  </Field>
                  <Field label="Ticker">
                    <input className={inputCls} placeholder="GWD" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
                  </Field>
                </div>
              </div>
              <p className="mt-3 text-[11px] text-ink-3">
                The image is pinned and set as the token URI on-chain. PNG or GIF, square works best.
              </p>
              <div className="mt-4">
                <Field label="Description" hint="shown on the coin page">
                  <textarea
                    className={`${inputCls} h-20 resize-none`}
                    placeholder="What is this coin about?"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </Field>
              </div>
              <p className="mt-3 text-[11px] text-ink-3">
                Token address and creator address are assigned when you launch.
              </p>
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
              <Field label="Initial dev buy" hint="optional, in ETH">
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
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl bg-panel ring-1 ring-line">
              {image ? <img src={image} alt="token" className="h-full w-full object-cover" /> : <span className="text-[18px] text-ink-3">?</span>}
            </span>
            <div className="min-w-0">
              <p className="font-display truncate text-[15px] font-bold text-ink">{name || 'Your coin'}</p>
              <p className="tnum text-[12px] text-ink-3">${symbol || '···'}</p>
            </div>
          </div>
          <p className="eyebrow mt-5">Your coin, so far</p>
          <dl className="mt-4 space-y-3">
            {[
              ['Ticker', name && symbol ? `$${symbol}` : '·'],
              ['Launch price', p ? `${p} ETH` : '·'],
              ['Start mcap', startMcap ? `${compact(startMcap)} ETH` : '·'],
              ['Supply', sup ? compact(sup) : '·'],
              ['Liquidity', `${liquidityPct}%`],
              ['Trade tax', `${feePct}% · 50/50`],
              ['Dev buy', devBuy ? `${devBuy} ETH` : 'none'],
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
            onClick={launch}
            disabled={!ready}
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
