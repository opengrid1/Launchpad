import { useMemo, useState } from 'react'
import { parseEther, parseEventLogs } from 'viem'
import { useWallet } from '../lib/wallet'
import { useToast, errorMessage } from '../lib/toast'
import { publicClient } from '../lib/chain'
import { LAUNCHPAD, launchpadAbi } from '../lib/contracts'
import { buildTokenURI } from '../lib/metadata'
import { setBigBlocks } from '../lib/bigblocks'
import { parseAmount } from '../lib/format'
import { TokenImage } from '../components/TokenImage'

const DEFAULT_SUPPLY = '1000000000'

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
  const [supply, setSupply] = useState(DEFAULT_SUPPLY)
  const [devBuy, setDevBuy] = useState('')

  const [launching, setLaunching] = useState(false)
  const [steps, setSteps] = useState<[StepState, StepState, StepState]>(['idle', 'idle', 'idle'])
  const [launchedToken, setLaunchedToken] = useState<string | null>(null)
  const [restoringBlocks, setRestoringBlocks] = useState(false)
  const [blocksRestored, setBlocksRestored] = useState(false)

  const supplyWei = useMemo(() => {
    if (!/^\d+$/.test(supply.trim()) || supply.trim() === '') return null
    try {
      return parseEther(supply.trim())
    } catch {
      return null
    }
  }, [supply])

  const devBuyWei = devBuy.trim() === '' ? 0n : parseAmount(devBuy)

  const formError =
    name.trim().length === 0 || name.trim().length > 48
      ? 'Name required'
      : symbol.trim().length === 0 || symbol.trim().length > 12
        ? 'Symbol required'
        : supplyWei === null || supplyWei === 0n
          ? 'Invalid supply'
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

      // 1) Flip the wallet to big blocks on HyperCore — pool creation needs ~6M gas.
      try {
        await setBigBlocks(walletClient, { address }, true)
      } catch (err) {
        const msg = errorMessage(err)
        // "does not exist" => the wallet has no HyperCore account yet.
        throw new Error(
          msg.includes('exist')
            ? 'This wallet has no HyperCore account yet — receive any amount on Hyperliquid once, then retry.'
            : msg,
          { cause: err },
        )
      }
      setSteps(['done', 'active', 'idle'])

      // 2) The launch transaction itself (atomic: token + pool + liquidity + dev buy).
      const tokenURI = buildTokenURI({
        name: name.trim(),
        description: description.trim(),
        image: image.trim(),
        website: website.trim(),
        twitter: twitter.trim(),
        telegram: telegram.trim(),
      })
      const hash = await walletClient.writeContract({
        address: LAUNCHPAD,
        abi: launchpadAbi,
        functionName: 'createToken',
        // minDevBuyTokens 0 is safe: the dev buy is atomic with pool creation, nothing can front-run it.
        args: [name.trim(), symbol.trim().toUpperCase(), tokenURI, supplyWei!, '0x0000000000000000000000000000000000000000', 0n, 0n],
        value: devBuyWei ?? 0n,
        account: address,
        chain: publicClient.chain,
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
        <h1 className="text-xl font-semibold tracking-tight text-fg">Launch</h1>

        <div className="mt-6 space-y-4">
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
              className={`${inputCls} resize-none`}
            />
          </Field>

          <Field label="Image URL">
            <div className="flex items-center gap-3">
              <input value={image} onChange={(e) => setImage(e.target.value)} placeholder="https://" className={inputCls} />
              {image.trim() && <TokenImage src={image.trim()} symbol={symbol || '?'} />}
            </div>
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Website">
              <input value={website} onChange={(e) => setWebsite(e.target.value)} className={inputCls} />
            </Field>
            <Field label="X">
              <input value={twitter} onChange={(e) => setTwitter(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Telegram">
              <input value={telegram} onChange={(e) => setTelegram(e.target.value)} className={inputCls} />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Supply">
              <input value={supply} onChange={(e) => setSupply(e.target.value.replace(/[^\d]/g, ''))} className={`${inputCls} font-mono`} />
            </Field>
            <Field label="Dev buy · HYPE">
              <input
                value={devBuy}
                onChange={(e) => setDevBuy(e.target.value)}
                placeholder="0.0"
                inputMode="decimal"
                className={`${inputCls} font-mono`}
              />
            </Field>
          </div>
        </div>

        <div className="mt-7 flex flex-wrap items-center gap-4">
          {!address ? (
            <button
              onClick={() => void connect()}
              className="btn-primary w-full cursor-pointer rounded-xl py-3.5 text-sm font-semibold sm:w-auto sm:px-10"
            >
              Connect
            </button>
          ) : (
            <button
              onClick={() => void launch()}
              disabled={launching || formError !== null}
              title={formError ?? undefined}
              className="btn-primary w-full cursor-pointer rounded-xl py-3.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto sm:px-10"
            >
              {launching ? 'Launching…' : 'Launch'}
            </button>
          )}
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
  'w-full rounded-xl bg-panel px-3.5 py-2.5 text-sm text-fg ring-1 ring-hair outline-none transition placeholder:text-ghost focus:ring-acc/50'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-ghost">{label}</span>
      {children}
    </label>
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
