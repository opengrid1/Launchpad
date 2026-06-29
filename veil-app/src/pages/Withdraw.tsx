import { useState } from 'react'
import { Steps } from '../components/Steps'
import {
  isAddress,
  nullifierHash,
  parseNote,
  shortHex,
  type ParsedNote,
} from '../lib/notes'
import { RELAYER_FEE_BPS, poolFor } from '../data/pool'

type Phase = 'form' | 'proving' | 'done'

export function Withdraw() {
  const [raw, setRaw] = useState('')
  const [recipient, setRecipient] = useState('')
  const [useRelayer, setUseRelayer] = useState(true)
  const [phase, setPhase] = useState<Phase>('form')
  const [result, setResult] = useState<{ note: ParsedNote; nullifierHash: string } | null>(null)

  const parsed = raw.trim() ? parseNote(raw) : null
  const noteError = raw.trim().length > 0 && !parsed
  const recipientOk = isAddress(recipient)
  const canWithdraw = !!parsed && recipientOk && phase === 'form'

  const active = phase === 'form' ? 0 : phase === 'proving' ? 1 : 2

  const fee = parsed && useRelayer ? (parsed.denomination * RELAYER_FEE_BPS) / 10_000 : 0
  const received = parsed ? parsed.denomination - fee : 0

  async function withdraw() {
    if (!parsed) return
    setPhase('proving')
    // simulate zk proof generation — the slow step in a real client
    await new Promise((r) => setTimeout(r, 1900))
    const nh = await nullifierHash(parsed.nullifier)
    setResult({ note: parsed, nullifierHash: nh })
    setPhase('done')
  }

  function reset() {
    setRaw('')
    setRecipient('')
    setResult(null)
    setPhase('form')
  }

  const inputCls =
    'w-full rounded-xl bg-void-850 px-3.5 py-2.5 font-mono text-sm text-fog-100 ring-1 ring-void-700 outline-none transition placeholder:text-fog-500/50 focus:ring-iris-500/60'

  return (
    <main className="rise-in mt-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Withdraw</h1>
          <p className="mt-1.5 max-w-md text-[14px] leading-relaxed text-fog-300">
            Prove you own a deposit without revealing which one, and send it to a fresh address.
          </p>
        </div>
        <Steps labels={['Note', 'Prove', 'Sent']} active={active} />
      </div>

      <div className="mt-7 grid gap-6 lg:grid-cols-[1fr_320px]">
        <section className="rounded-2xl bg-void-900 p-5 ring-1 ring-void-700">
          {phase !== 'done' ? (
            <>
              <label className="block">
                <span className="text-[13px] font-semibold text-fog-100">Secret note</span>
                <textarea
                  value={raw}
                  onChange={(e) => setRaw(e.target.value)}
                  rows={3}
                  placeholder="veil-hype-1-…"
                  className={`${inputCls} mt-1.5 resize-none break-all ${
                    noteError ? 'ring-rose-soft/60' : ''
                  }`}
                />
              </label>
              {noteError && (
                <p className="mt-1.5 text-[12px] text-rose-soft">
                  That doesn&apos;t look like a valid Veil note.
                </p>
              )}
              {parsed && (
                <p className="mt-1.5 font-mono text-[12px] text-mint-400">
                  ✓ Valid note · {parsed.denomination} HYPE pool
                </p>
              )}

              <label className="mt-5 block">
                <span className="text-[13px] font-semibold text-fog-100">Recipient address</span>
                <input
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder="0x…"
                  className={`${inputCls} mt-1.5 ${
                    recipient && !recipientOk ? 'ring-rose-soft/60' : ''
                  }`}
                />
              </label>
              <p className="mt-1.5 text-[12px] text-fog-500">
                Use an address with no history tied to your deposit — ideally a brand new one.
              </p>

              <label className="mt-5 flex cursor-pointer items-start gap-2.5 text-[13px] text-fog-300">
                <input
                  type="checkbox"
                  checked={useRelayer}
                  onChange={(e) => setUseRelayer(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-(--color-iris-500)"
                />
                <span>
                  Withdraw via relayer ({(RELAYER_FEE_BPS / 100).toFixed(2)}% fee). The relayer pays
                  gas so the recipient needs zero HYPE to receive — keeping the new address clean.
                </span>
              </label>

              <button
                onClick={withdraw}
                disabled={!canWithdraw}
                className="mt-6 w-full cursor-pointer rounded-xl bg-iris-500 py-3 text-sm font-bold text-void-950 transition hover:bg-iris-400 disabled:cursor-not-allowed disabled:bg-void-700 disabled:text-fog-500"
              >
                {phase === 'proving' ? 'Generating proof…' : 'Withdraw'}
              </button>
              {phase === 'proving' && (
                <div className="mt-4 overflow-hidden rounded-full bg-void-850">
                  <div className="shimmer h-1.5 w-full" />
                </div>
              )}
            </>
          ) : (
            result && (
              <>
                <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-mint-400">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-mint-500/15 text-mint-400">
                    ✓
                  </span>
                  Withdrawal sent
                </div>
                <p className="mt-3 text-[14px] leading-relaxed text-fog-300">
                  <span className="font-mono text-fog-100">{received} HYPE</span> sent to{' '}
                  <span className="font-mono text-fog-100">{shortHex(recipient, 6, 4)}</span>. The
                  pool only learns a nullifier was spent — never which deposit it matched.
                </p>
                <dl className="mt-4 space-y-2.5 rounded-xl bg-void-950 p-4 text-[13px] ring-1 ring-void-700">
                  {[
                    ['Nullifier hash', shortHex(result.nullifierHash)],
                    ['Recipient', shortHex(recipient, 6, 4)],
                    ['Relayer fee', useRelayer ? `${fee} HYPE` : '—'],
                    ['Received', `${received} HYPE`],
                  ].map(([k, v]) => (
                    <div key={k} className="flex items-baseline justify-between gap-3">
                      <dt className="text-fog-500">{k}</dt>
                      <dd className="font-mono text-fog-100">{v}</dd>
                    </div>
                  ))}
                </dl>
                <button
                  onClick={reset}
                  className="mt-5 w-full cursor-pointer rounded-xl bg-void-800 py-3 text-sm font-semibold text-fog-100 ring-1 ring-void-700 transition hover:ring-void-600"
                >
                  New withdrawal
                </button>
              </>
            )
          )}
        </section>

        <aside className="h-fit space-y-4">
          <div className="rounded-2xl bg-void-900 p-5 ring-1 ring-void-700">
            <h3 className="text-sm font-semibold">You&apos;ll receive</h3>
            <p className="mt-3 font-mono text-3xl font-semibold text-iris-300">
              {parsed ? received : '—'}
              <span className="ml-1.5 text-base text-fog-500">HYPE</span>
            </p>
            <dl className="mt-4 space-y-2.5 text-[13px]">
              {[
                ['From pool', parsed ? `${parsed.denomination} HYPE` : '—'],
                ['Relayer fee', parsed && useRelayer ? `${fee} HYPE` : useRelayer ? '—' : 'off'],
                [
                  'Anonymity set',
                  parsed ? poolFor(parsed.denomination).deposits.toLocaleString() : '—',
                ],
              ].map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-3">
                  <dt className="text-fog-500">{k}</dt>
                  <dd className="font-mono text-fog-100">{v}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="rounded-2xl border border-dashed border-void-700 p-4 text-[12px] leading-relaxed text-fog-500">
            <span className="font-semibold text-fog-300">Demo build.</span> No real proof is
            generated and nothing settles on-chain — the &ldquo;proving&rdquo; delay just mimics the
            real client. Don&apos;t paste a note you actually rely on.
          </div>
        </aside>
      </div>
    </main>
  )
}
