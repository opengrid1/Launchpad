import { useRef, useState } from 'react'
import { parseEther, parseEventLogs, isAddress, zeroAddress, type Address } from 'viem'
import { useWallet } from '../lib/wallet'
import { useToast, errorMessage } from '../lib/toast'
import { publicClient } from '../lib/chain'
import { LAUNCHPAD, launchpadAbi } from '../lib/contracts'
import { buildTokenURI } from '../lib/metadata'
import { compressImage } from '../lib/image'
import { setBigBlocks } from '../lib/bigblocks'
import { parseAmount } from '../lib/format'
import { TokenImage } from '../components/TokenImage'

const SUPPLY_WEI = parseEther('1000000000') // fixed 1B supply for every launch

type StepState = 'idle' | 'active' | 'done' | 'failed'

export function LaunchPage() {
  const { address, walletClient, connect, ensureChain } = useWallet()
  const { push } = useToast()

  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [description, setDescription] = useState('')
  const [image, setImage] = useState('')
  const [website, setWebsite] = useState('')
  const [twitter, setTwitter] = useState('')
  const [telegram, setTelegram] = useState('')
  const [devBuy, setDevBuy] = useState('')
  const [payout, setPayout] = useState('')

  const [launching, setLaunching] = useState(false)
  const [steps, setSteps] = useState<[StepState, StepState, StepState]>(['idle', 'idle', 'idle'])
  const [launchedToken, setLaunchedToken] = useState<string | null>(null)
  const [restoringBlocks, setRestoringBlocks] = useState(false)
  const [blocksRestored, setBlocksRestored] = useState(false)

  const devBuyWei = devBuy.trim() === '' ? 0n : parseAmount(devBuy)

  const formError =
    name.trim().length === 0 || name.trim().length > 48
      ? 'Name required'
      : symbol.trim().length === 0 || symbol.trim().length > 12
        ? 'Symbol required'
        : devBuyWei === null
          ? 'Invalid dev buy'
          : null

  async function launch() {
    if (!walletClient || !address || formError) return
    setLaunching(true)
    setLaunchedToken(null)
    setBlocksRestored(false)
    setSteps(['active', 'idle', 'idle'])
    try {
      await ensureChain()

      // 1) Enable big blocks. A launch uses ~6M gas, which only fits a HyperEVM big block
      //    (30M); in small-block mode (2M) the network rejects the tx. We try to flip the
      //    wallet via the HyperCore L1 action (signed under chainId 1337) — but some
      //    wallets (e.g. MetaMask) refuse to sign typed-data whose chainId differs from
      //    the connected chain. If that signature is declined we DON'T abort: big blocks
      //    may already be enabled for this wallet, so we warn and let the launch proceed.
      let bigBlocksOn = false
      for (let attempt = 0; attempt < 2 && !bigBlocksOn; attempt++) {
        try {
          await setBigBlocks(walletClient, { address }, true)
          bigBlocksOn = true
        } catch {
          /* retry once, then fall through */
        }
      }
      push(
        bigBlocksOn
          ? { kind: 'info', title: 'Big blocks enabled' }
          : {
              kind: 'info',
              title: 'Continuing — big blocks must already be on',
              detail: 'Your wallet declined the big-block signature. If big blocks are already enabled for this wallet the launch still goes through; otherwise it will fail with a gas-limit error.',
            },
      )
      setSteps(['done', 'active', 'idle'])

      // Give the big-block switch a moment to take effect on the EVM RPC before sending.
      await new Promise((r) => setTimeout(r, 7000))

      // 2) The launch transaction itself (atomic: token + pool + liquidity + dev buy).
      // Fee recipient: a pasted EVM address routes fees there; an @handle (or empty)
      // routes to the connected wallet and is stored as the creator's X for display.
      const payoutTrim = payout.trim()
      const recipient: Address = isAddress(payoutTrim) ? (payoutTrim as Address) : zeroAddress
      const xHandle = payoutTrim.startsWith('@') ? payoutTrim : twitter.trim()
      const tokenURI = buildTokenURI({
        name: name.trim(),
        description: description.trim(),
        image: image.trim(),
        website: website.trim(),
        twitter: xHandle,
        telegram: telegram.trim(),
      })
      // On mobile especially, the launch tx prompt opens in the wallet app — tell the
      // user to go confirm it, otherwise the page just sits on "Launching…".
      push({ kind: 'info', title: 'Confirm the launch in your wallet' })
      const hash = await walletClient.writeContract({
        address: LAUNCHPAD,
        abi: launchpadAbi,
        functionName: 'createToken',
        // creator = 0 -> the connected wallet keeps control; fees route to `recipient`
        // (a pasted address, or 0 to default to the creator). minDevBuyTokens 0 is safe:
        // the dev buy is atomic with pool creation, nothing can front-run it.
        args: [name.trim(), symbol.trim().toUpperCase(), tokenURI, SUPPLY_WEI, zeroAddress, recipient, 0n, 0n],
        value: devBuyWei ?? 0n,
        account: address,
        chain: publicClient.chain,
        // Explicit gas: HyperEVM's eth_estimateGas caps at the small-block limit (2M),
        // which would reject this ~6-16M launch tx. A fixed limit (well under the 30M
        // big-block limit) skips estimation so it runs in the big block.
        gas: 24_000_000n,
      })
      push({ kind: 'info', title: 'Launching — next big block (~1 min)', txHash: hash })
      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 240_000 })
      if (receipt.status !== 'success') throw new Error('Launch transaction reverted')

      const [event] = parseEventLogs({ abi: launchpadAbi, logs: receipt.logs, eventName: 'TokenLaunched' })
      const token = event?.args.token ?? null
      setLaunchedToken(token)
      setSteps(['done', 'done', 'active'])
      push({ kind: 'success', title: `$${symbol.trim().toUpperCase()} is live`, txHash: hash })
    } catch (err) {
      setSteps((s) => (s[1] === 'active' ? ['done', 'failed', 'idle'] : ['failed', 'idle', 'idle']))
      push({ kind: 'error', title: 'Launch failed', detail: errorMessage(err) })
    } finally {
      setLaunching(false)
    }
  }

  async function restoreBlocks() {
    if (!walletClient || !address) return
    setRestoringBlocks(true)
    try {
      await setBigBlocks(walletClient, { address }, false)
      setBlocksRestored(true)
      setSteps(['done', 'done', 'done'])
      push({ kind: 'success', title: 'Fast blocks restored' })
    } catch (err) {
      push({ kind: 'error', title: 'Switch failed', detail: errorMessage(err) })
    } finally {
      setRestoringBlocks(false)
    }
  }

  return (
    <main className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-[1fr_330px]">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Create a token</h1>
        <p className="mt-1.5 text-sm text-dim">
          Deploy a live market on HyperSwap V3 in one click. You earn <span className="text-acc">70%</span> of every trade.
        </p>

        <div className="elev mt-6 rounded-2xl p-5 ring-1 ring-hair sm:p-6">
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_140px]">
              <Field label="Name">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Token" maxLength={48} className={inputCls} />
              </Field>
              <Field label="Symbol">
                <input
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.replace(/[^a-zA-Z0-9]/g, ''))}
                  placeholder="TKN"
                  maxLength={12}
                  className={`${inputCls} uppercase`}
                />
              </Field>
            </div>

            <Field label="Description">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder="What's the story?"
                className={`${inputCls} resize-none`}
              />
            </Field>

            <div>
              <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-ghost">Image</span>
              <ImageUpload value={image} onChange={setImage} symbol={symbol} />
            </div>

            <Socials
              website={website}
              twitter={twitter}
              telegram={telegram}
              setWebsite={setWebsite}
              setTwitter={setTwitter}
              setTelegram={setTelegram}
            />

            <Field label="Dev buy · HYPE (optional)">
              <input
                value={devBuy}
                onChange={(e) => setDevBuy(e.target.value)}
                placeholder="0.0"
                inputMode="decimal"
                className={`${inputCls} font-mono`}
              />
            </Field>

            <div>
              <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-ghost">Fees payout</span>
              <input
                value={payout}
                onChange={(e) => setPayout(e.target.value)}
                placeholder="Paste 0x… wallet  (or @handle for display)"
                className={inputCls}
              />
              <p
                className={`mt-1.5 font-mono text-[10px] leading-relaxed ${
                  payout.trim() !== '' && !isAddress(payout.trim()) ? 'text-amber' : 'text-ghost'
                }`}
              >
                {payout.trim() === ''
                  ? 'Default: your connected wallet. Paste a 0x address to send the 70% there instead.'
                  : isAddress(payout.trim())
                    ? '✓ Fees route to this wallet on-chain.'
                    : '⚠ An @handle does not route fees yet — they go to your connected wallet (the handle is just shown on your token). Paste a 0x address to route fees.'}
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-3 border-t border-hair pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="font-mono text-[11px] leading-relaxed text-ghost">
              $4,000 start · 100% supply pooled · you keep 70% of fees
            </p>
            {!address ? (
              <button
                onClick={() => void connect()}
                className="btn-primary w-full shrink-0 cursor-pointer rounded-xl py-3 text-sm font-semibold sm:w-auto sm:px-8"
              >
                Connect
              </button>
            ) : (
              <button
                onClick={() => void launch()}
                disabled={launching || formError !== null}
                title={formError ?? undefined}
                className="btn-primary w-full shrink-0 cursor-pointer rounded-xl py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto sm:px-8"
              >
                {launching ? 'Launching…' : 'Launch token'}
              </button>
            )}
          </div>
        </div>
      </section>

      {/* right rail */}
      <aside className="space-y-4">
        <div className="elev rounded-2xl p-4 ring-1 ring-hair">
          <div className="flex items-center gap-3">
            <TokenImage src={image.trim() || undefined} symbol={symbol || '?'} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-fg">{name.trim() || 'My Token'}</p>
              <p className="truncate font-mono text-xs text-ghost">${symbol.trim().toUpperCase() || 'TKN'}</p>
            </div>
            <div className="text-right">
              <p className="font-mono text-sm text-fg">$4.0K</p>
              <p className="font-mono text-[11px] text-up">+0.0%</p>
            </div>
          </div>
          {description.trim() && <p className="mt-3 line-clamp-2 text-[13px] leading-snug text-dim">{description.trim()}</p>}
        </div>

        {steps.some((s) => s !== 'idle') && (
        <div className="elev rounded-2xl p-5 ring-1 ring-hair">
          <ol className="space-y-3.5">
            <Step n={1} state={steps[0]} title="Big blocks" />
            <Step n={2} state={steps[1]} title="Launch" />
            <Step n={3} state={steps[2]} title="Fast blocks" />
          </ol>

          {steps[2] === 'active' && (
            <div className="mt-4 space-y-2">
              {launchedToken && (
                <a
                  href={`#/t/${launchedToken}`}
                  className="btn-primary block w-full rounded-xl py-2.5 text-center text-sm font-semibold no-underline"
                >
                  Open token →
                </a>
              )}
              <button
                onClick={() => void restoreBlocks()}
                disabled={restoringBlocks}
                className="w-full cursor-pointer rounded-xl py-2.5 text-sm font-bold text-fg ring-1 ring-hair2 transition hover:bg-panel2 disabled:opacity-60"
              >
                {restoringBlocks ? 'Switching…' : 'Restore fast blocks'}
              </button>
            </div>
          )}
          {blocksRestored && launchedToken && (
            <a
              href={`#/t/${launchedToken}`}
              className="btn-primary mt-4 block w-full rounded-xl py-2.5 text-center text-sm font-semibold no-underline"
            >
              Open token →
            </a>
          )}
        </div>
        )}
      </aside>
    </main>
  )
}

const inputCls =
  'w-full rounded-xl bg-base px-3.5 py-2.5 text-sm text-fg ring-1 ring-hair outline-none transition placeholder:text-ghost focus:ring-acc/50'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-ghost">{label}</span>
      {children}
    </label>
  )
}

function ImageUpload({ value, onChange, symbol }: { value: string; onChange: (v: string) => void; symbol: string }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)

  async function handle(file?: File) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setErr('Not an image file')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      onChange(await compressImage(file))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not read image')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault()
        setDrag(true)
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDrag(false)
        void handle(e.dataTransfer.files?.[0])
      }}
      className={`flex cursor-pointer items-center gap-3 rounded-xl border border-dashed bg-panel px-3.5 py-3 transition ${
        drag ? 'border-acc bg-accsoft' : 'border-hair2 hover:border-acc/50'
      }`}
    >
      {value ? (
        <img src={value} alt="" className="h-12 w-12 rounded-lg object-cover ring-1 ring-hair" />
      ) : (
        <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-panel2 text-base font-bold text-ghost ring-1 ring-hair">
          {symbol.slice(0, 1).toUpperCase() || '?'}
        </span>
      )}
      <div className="min-w-0">
        <p className="text-sm text-fg">{busy ? 'Processing…' : value ? 'Change image' : 'Upload image'}</p>
        <p className={`font-mono text-[11px] ${err ? 'text-down' : 'text-ghost'}`}>{err ?? 'PNG · JPG · GIF'}</p>
      </div>
      {value && !busy && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onChange('')
            setErr(null)
          }}
          className="ml-auto cursor-pointer rounded-lg px-2 py-1 text-ghost transition hover:text-down"
          aria-label="Remove image"
        >
          ✕
        </button>
      )}
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => void handle(e.target.files?.[0])} />
    </div>
  )
}

function Socials({
  website,
  twitter,
  telegram,
  setWebsite,
  setTwitter,
  setTelegram,
}: {
  website: string
  twitter: string
  telegram: string
  setWebsite: (v: string) => void
  setTwitter: (v: string) => void
  setTelegram: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const count = [website, twitter, telegram].filter((v) => v.trim() !== '').length

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full cursor-pointer items-center justify-between rounded-xl bg-panel px-3.5 py-2.5 ring-1 ring-hair transition hover:ring-hair2"
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ghost">Socials</span>
        <span className="flex items-center gap-2 text-xs text-dim">
          {count > 0 && <span className="font-mono text-acc">{count} added</span>}
          <svg className={`transition-transform ${open ? 'rotate-180' : ''}`} width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2.5 4.5 L6 8 L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      {open && (
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Website">
            <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="mysite.xyz" className={inputCls} />
          </Field>
          <Field label="X">
            <input value={twitter} onChange={(e) => setTwitter(e.target.value)} placeholder="x.com/…" className={inputCls} />
          </Field>
          <Field label="Telegram">
            <input value={telegram} onChange={(e) => setTelegram(e.target.value)} placeholder="t.me/…" className={inputCls} />
          </Field>
        </div>
      )}
    </div>
  )
}

function Step({ n, state, title }: { n: number; state: StepState; title: string }) {
  const badge =
    state === 'done' ? (
      <span className="flex h-5.5 w-5.5 items-center justify-center rounded-full bg-up text-[10px] font-bold text-base">✓</span>
    ) : state === 'active' ? (
      <span className="live-dot flex h-5.5 w-5.5 items-center justify-center rounded-full bg-accsoft font-mono text-[10px] font-bold text-acc ring-1 ring-acc/40">
        {n}
      </span>
    ) : state === 'failed' ? (
      <span className="flex h-5.5 w-5.5 items-center justify-center rounded-full bg-downsoft text-[10px] font-bold text-down ring-1 ring-down/40">✕</span>
    ) : (
      <span className="flex h-5.5 w-5.5 items-center justify-center rounded-full font-mono text-[10px] font-bold text-ghost ring-1 ring-hair">{n}</span>
    )
  return (
    <li className="flex items-center gap-3">
      {badge}
      <span className={`text-[13px] font-semibold ${state === 'idle' ? 'text-ghost' : 'text-fg'}`}>{title}</span>
    </li>
  )
}
