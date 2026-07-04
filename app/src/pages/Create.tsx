import { useState } from 'react'
import { compact, defaultTokenImage, usd } from '../data/launches'
import * as loxley from '../loxley'
import type { Wallet } from '../web3/useWallet'

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

// Uploaded images must live on-chain (no IPFS/host wired), so a blob: URL
// won't survive. Resize to a small JPEG data-URI that can be stored in the
// token metadata and rendered by anyone.
async function fileToDataUri(file: File, max = 160, quality = 0.72): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = rej
      i.src = url
    })
    const scale = Math.min(1, max / Math.max(img.width, img.height))
    const w = Math.max(1, Math.round(img.width * scale))
    const h = Math.max(1, Math.round(img.height * scale))
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    c.getContext('2d')!.drawImage(img, 0, 0, w, h)
    return c.toDataURL('image/jpeg', quality)
  } finally {
    URL.revokeObjectURL(url)
  }
}

// fixed terms enforced by the launchpad contract: 1B supply, 1% tax, whole
// supply single-sided in the v4 pool, price derived from the virtual mcap.
const SUPPLY = 1_000_000_000
const START_MCAP_USD = 2000 // matches the deployed launchpad's startingMarketCapUsd6

export function Create({ onBack, onLaunched, wallet }: { onBack: () => void; onLaunched: () => void | Promise<void>; wallet: Wallet }) {
  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [image, setImage] = useState('')
  const [description, setDescription] = useState('')
  const [x, setX] = useState('')
  const [telegram, setTelegram] = useState('')
  const [website, setWebsite] = useState('')
  const [devBuy, setDevBuy] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const dev = parseFloat(devBuy) || 0
  const ready = Boolean(name && symbol) && !busy

  async function launch() {
    if (!ready) return
    setErr(null)
    setBusy(true)
    try {
      // get a live signer (connect on the fly if needed)
      let signer = wallet.signer
      let account = wallet.account
      if (!signer) {
        const c = await loxley.connectWallet()
        signer = c.signer
        account = c.account
      }
      await loxley.createToken(signer, {
        name,
        symbol,
        supply: SUPPLY,
        creator: account ?? undefined,
        meta: {
          image: image || undefined,
          description: description || undefined,
          twitter: x || undefined,
          telegram: telegram || undefined,
          website: website || undefined,
        },
        devBuyEth: devBuy || '0',
      })
      await onLaunched()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Launch failed')
    } finally {
      setBusy(false)
    }
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
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  if (!f) return
                  try {
                    setImage(await fileToDataUri(f))
                  } catch {
                    setImage('')
                  }
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
            {busy ? 'Launching…' : wallet.account ? 'Launch coin' : 'Connect & launch'}
          </button>
          {err && <p className="mt-3 break-words text-[12px] text-clay">{err}</p>}
          <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
            Deploys on Robinhood Chain. 1B supply, 1% trade tax split 50/50 to holders and you.
          </p>
        </aside>
      </div>
    </main>
  )
}
