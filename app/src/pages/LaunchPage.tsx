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
      ? 'Name is required (max 48 chars)'
      : symbol.trim().length === 0 || symbol.trim().length > 12
        ? 'Symbol is required (max 12 chars)'
        : supplyWei === null || supplyWei === 0n
          ? 'Supply must be a whole number of tokens'
          : devBuyWei === null
            ? 'Dev buy must be a valid HYPE amount'
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
            ? 'Your wallet has no HyperCore account yet. Bridge or receive any amount on Hyperliquid once, then retry.'
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
      push({ kind: 'info', title: 'Launch submitted — waiting for a big block (~1 min)', txHash: hash })
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
      push({ kind: 'success', title: 'Wallet switched back to fast blocks' })
    } catch (err) {
      push({ kind: 'error', title: 'Switch back failed', detail: errorMessage(err) })
    } finally {
      setRestoringBlocks(false)
    }
  }

  return (
    <main className="mt-2 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_340px]">
      <section>
        <h1 className="text-2xl font-bold tracking-tight text-fog-100">Launch a token</h1>
        <p className="mt-1 max-w-xl text-sm text-fog-300">
          One transaction deploys your token, creates its HyperSwap V3 pool at a{' '}
          <span className="font-mono text-mint-400">$4,000</span> market cap, and locks 100% of the supply as liquidity.
          You earn <span className="font-mono text-mint-400">70%</span> of every trade's fee, forever.
        </p>

        <div className="mt-6 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_140px]">
            <Field label="Name" required>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Token" maxLength={48} className={inputCls} />
            </Field>
            <Field label="Symbol" required>
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
              placeholder="What's the story?"
              rows={3}
              maxLength={500}
              className={`${inputCls} resize-none`}
            />
          </Field>

          <Field label="Image URL" hint="https:// or ipfs:// — shown on the board and token page">
            <div className="flex items-center gap-3">
              <input value={image} onChange={(e) => setImage(e.target.value)} placeholder="https://…/logo.png" className={inputCls} />
              {image.trim() && <TokenImage src={image.trim()} symbol={symbol || '?'} />}
            </div>
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Website">
              <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="mytoken.xyz" className={inputCls} />
            </Field>
            <Field label="X / Twitter">
              <input value={twitter} onChange={(e) => setTwitter(e.target.value)} placeholder="x.com/mytoken" className={inputCls} />
            </Field>
            <Field label="Telegram">
              <input value={telegram} onChange={(e) => setTelegram(e.target.value)} placeholder="t.me/mytoken" className={inputCls} />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Total supply" hint="whole tokens · all of it goes in the pool">
              <input value={supply} onChange={(e) => setSupply(e.target.value.replace(/[^\d]/g, ''))} className={`${inputCls} font-mono`} />
            </Field>
            <Field label="Dev buy (optional)" hint="HYPE spent buying your own token first, atomically">
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

        {!address ? (
          <button
            onClick={() => void connect()}
            className="mt-6 w-full cursor-pointer rounded-xl bg-mint-500 py-3.5 text-sm font-semibold text-ink-950 transition hover:bg-mint-400 sm:w-auto sm:px-10"
          >
            Connect wallet to launch
          </button>
        ) : (
          <button
            onClick={() => void launch()}
            disabled={launching || formError !== null}
            title={formError ?? undefined}
            className="mt-6 w-full cursor-pointer rounded-xl bg-mint-500 py-3.5 text-sm font-semibold text-ink-950 transition hover:bg-mint-400 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:px-10"
          >
            {launching ? 'Launching…' : `Launch $${symbol.trim().toUpperCase() || 'TOKEN'}`}
          </button>
        )}
        {formError && (name || symbol) && <p className="mt-2 font-mono text-xs text-amber-glow">{formError}</p>}
      </section>

      {/* right rail: how it works + live progress */}
      <aside className="space-y-4">
        <section className="rounded-2xl bg-ink-850/80 p-5 ring-1 ring-ink-700">
          <h2 className="text-sm font-bold text-fog-100">Launch progress</h2>
          <ol className="mt-4 space-y-4">
            <Step
              n={1}
              state={steps[0]}
              title="Enable big blocks"
              detail="A free HyperCore signature — creating a V3 pool needs ~6M gas, more than a fast block fits."
            />
            <Step
              n={2}
              state={steps[1]}
              title="Launch transaction"
              detail="Token + pool + locked liquidity + your dev buy, all in one atomic tx. Confirms in the next big block (~1 min)."
            />
            <Step
              n={3}
              state={steps[2]}
              title="Back to fast blocks"
              detail="Switch your wallet back so your normal transactions stay ~1s."
            />
          </ol>

          {steps[2] === 'active' && (
            <div className="mt-4 space-y-2">
              {launchedToken && (
                <a
                  href={`#/t/${launchedToken}`}
                  className="block w-full rounded-xl bg-mint-500 py-2.5 text-center text-sm font-semibold text-ink-950 no-underline transition hover:bg-mint-400"
                >
                  Open your token page →
                </a>
              )}
              <button
                onClick={() => void restoreBlocks()}
                disabled={restoringBlocks}
                className="w-full cursor-pointer rounded-xl bg-ink-700 py-2.5 text-sm font-semibold text-fog-100 ring-1 ring-ink-600 transition hover:ring-mint-500/50 disabled:opacity-60"
              >
                {restoringBlocks ? 'Switching…' : 'Switch back to fast blocks'}
              </button>
            </div>
          )}
          {blocksRestored && launchedToken && (
            <a
              href={`#/t/${launchedToken}`}
              className="mt-4 block w-full rounded-xl bg-mint-500 py-2.5 text-center text-sm font-semibold text-ink-950 no-underline transition hover:bg-mint-400"
            >
              Open your token page →
            </a>
          )}
        </section>

        <section className="rounded-2xl bg-ink-850/80 p-5 ring-1 ring-ink-700">
          <h2 className="text-sm font-bold text-fog-100">The deal</h2>
          <ul className="mt-3 space-y-2.5 text-[13px] leading-relaxed text-fog-300">
            <li>• Starts at a <span className="font-mono text-fog-100">$4,000</span> market cap — same for everyone, priced via the HYPE oracle at launch.</li>
            <li>• 100% of supply is pool liquidity. No team allocation, no presale. Want tokens? Dev buy.</li>
            <li>• Trades on HyperSwap V3 with a 1% fee: <span className="font-mono text-mint-400">70%</span> to you, 30% to the platform.</li>
            <li>• Claim your earnings any time in native HYPE, right from the token page.</li>
          </ul>
        </section>
      </aside>
    </main>
  )
}

const inputCls =
  'w-full rounded-xl bg-ink-900 px-3.5 py-2.5 text-sm text-fog-100 ring-1 ring-ink-700 outline-none transition placeholder:text-fog-500 focus:ring-mint-500/50'

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between">
        <span className="text-xs font-semibold text-fog-300">
          {label}
          {required && <span className="ml-0.5 text-mint-400">*</span>}
        </span>
        {hint && <span className="font-mono text-[10px] text-fog-500">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

function Step({ n, state, title, detail }: { n: number; state: StepState; title: string; detail: string }) {
  const badge =
    state === 'done' ? (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-mint-500 text-xs font-bold text-ink-950">✓</span>
    ) : state === 'active' ? (
      <span className="live-dot flex h-6 w-6 items-center justify-center rounded-full bg-mint-500/20 text-xs font-bold text-mint-300 ring-1 ring-mint-500/50">
        {n}
      </span>
    ) : state === 'failed' ? (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-rose-soft/20 text-xs font-bold text-rose-soft ring-1 ring-rose-soft/50">✕</span>
    ) : (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink-700 text-xs font-bold text-fog-500">{n}</span>
    )
  return (
    <li className="flex gap-3">
      {badge}
      <div className="min-w-0 flex-1">
        <p className={`text-[13px] font-semibold ${state === 'idle' ? 'text-fog-500' : 'text-fog-100'}`}>{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-fog-500">{detail}</p>
      </div>
    </li>
  )
}
