import { useState } from 'react'
import { compact, defaultTokenImage, ETH_USD, usd, type Launch } from '../data/launches'

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

// fixed terms: 1B supply, 1% tax, whole supply single-sided in the v3 pool,
// and every coin starts at a $2.5K virtual market cap (so price is derived).
const SUPPLY = 1_000_000_000
const START_MCAP_USD = 2500
const PRICE_ETH = START_MCAP_USD / (SUPPLY * ETH_USD)

export function Create({ onBack, onLaunch }: { onBack: () => void; onLaunch: (coin: Launch) => void }) {
  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [image, setImage] = useState('')
  const [description, setDescription] = useState('')
  const [x, setX] = useState('')
  const [telegram, setTelegram] = useState('')
  const [website, setWebsite] = useState('')
  const [devBuy, setDevBuy] = useState('')

  const dev = parseFloat(devBuy) || 0
  const ready = Boolean(name && symbol)

  function launch() {
    if (!ready) return
    onLaunch({
      id: Date.now(),
      name,
      symbol,
      glyph: '🪙',
      image: image || defaultTokenImage(symbol),
      tagline: description ? description.slice(0, 90) : `${name} on Sherwood.`,
      description: description || undefined,
      tokenAddress: `0x${hex4()}…${hex4()}`,
      devBuy: dev || undefined,
      socials: x || telegram || website ? { x: x || undefined, telegram: telegram || undefined, website: website || undefined } : undefined,
      priceEth: PRICE_ETH,
      tokensForLiquidity: SUPPLY, // single-sided: the whole supply seeds the pool
      tokensForSale: 0,
      liquidityBps: 10_000,
      tradeFeeBps: 100, // fixed 1%
      volume: dev,
      rewardsPaid: 0,
      holders: dev > 0 ? 1 : 0,
      createdAgo: 'just now',
      buyers: dev > 0 ? 1 : 0,
      status: 'live',
      creator: '0x71b3…9F02',
      yourTokens: dev > 0 ? Math.floor(dev / PRICE_ETH) : 0,
      yourHolderRewards: 0,
      yourRebate: 0,
    })
  }

  return (
    <main className="rise-in mx-auto max-w-4xl py-8">
      <button onClick={onBack} className="text-[13px] text-ink-2 transition-colors hover:text-ink">
        ← All coins
      </button>

      <h1 className="font-display mt-5 text-[30px] font-extrabold leading-none tracking-tight">Create a coin</h1>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_300px]">
        {/* one form */}
        <div className="rounded-2xl bg-surface p-5 ring-1 ring-line">
          <div className="flex gap-4">
            <label className="group relative flex h-24 w-24 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-xl bg-panel ring-1 ring-line transition hover:ring-emerald/50">
              {image ? (
                <img src={image} alt="token" className="h-full w-full object-cover" />
              ) : symbol ? (
                <>
                  <img src={defaultTokenImage(symbol)} alt="token" className="h-full w-full object-cover" />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/30 text-[11px] font-medium text-white opacity-0 transition group-hover:opacity-100">
                    ＋ change
                  </span>
                </>
              ) : (
                <span className="text-center text-[11px] leading-tight text-ink-3">
                  <span className="block text-[22px]">＋</span>
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
            <div className="grid flex-1 content-start gap-3">
              <Field label="Name">
                <input className={inputCls} placeholder="Greenwood" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Ticker">
                <input className={inputCls} placeholder="GWD" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase().slice(0, 8))} />
              </Field>
            </div>
          </div>

          <div className="mt-4">
            <Field label="Description" hint="optional">
              <textarea
                className={`${inputCls} h-20 resize-none`}
                placeholder="What is this coin about?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Field label="X" hint="optional">
              <input className={inputCls} placeholder="x.com/…" value={x} onChange={(e) => setX(e.target.value)} />
            </Field>
            <Field label="Telegram" hint="optional">
              <input className={inputCls} placeholder="t.me/…" value={telegram} onChange={(e) => setTelegram(e.target.value)} />
            </Field>
            <Field label="Website" hint="optional">
              <input className={inputCls} placeholder="https://…" value={website} onChange={(e) => setWebsite(e.target.value)} />
            </Field>
          </div>

          <div className="mt-4">
            <Field label="Initial dev buy" hint="optional, in ETH">
              <input className={inputCls} placeholder="0.0" value={devBuy} onChange={(e) => setDevBuy(e.target.value)} inputMode="decimal" />
            </Field>
          </div>
        </div>

        {/* preview + launch */}
        <aside className="h-fit rounded-2xl bg-surface p-5 ring-1 ring-line lg:sticky lg:top-24">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl bg-panel ring-1 ring-line">
              {image ? (
                <img src={image} alt="token" className="h-full w-full object-cover" />
              ) : symbol ? (
                <img src={defaultTokenImage(symbol)} alt="token" className="h-full w-full object-cover" />
              ) : (
                <span className="text-[11px] text-ink-3">img</span>
              )}
            </span>
            <div className="min-w-0">
              <p className="font-display truncate text-[15px] font-bold text-ink">{name || 'Your coin'}</p>
              <p className="tnum text-[12px] text-ink-3">${symbol || '···'}</p>
            </div>
          </div>

          <dl className="mt-5 space-y-2.5 border-t border-line pt-4">
            {[
              ['Start mcap', usd(START_MCAP_USD)],
              ['Supply', compact(SUPPLY)],
              ['Trade tax', '1%'],
              ['Dev buy', dev ? `${dev} ETH` : 'none'],
            ].map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-3">
                <dt className="text-[13px] text-ink-2">{k}</dt>
                <dd className="tnum text-[13px] text-ink">{v}</dd>
              </div>
            ))}
          </dl>

          <button
            onClick={launch}
            disabled={!ready}
            className="mt-5 w-full cursor-pointer rounded-full bg-emerald py-3 text-[14px] font-semibold text-paper transition hover:bg-emerald-strong disabled:cursor-not-allowed disabled:bg-panel disabled:text-ink-3"
          >
            Launch coin
          </button>
        </aside>
      </div>
    </main>
  )
}
