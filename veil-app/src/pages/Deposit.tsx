import { useState } from 'react'
import { DenominationPicker } from '../components/DenominationPicker'
import { NoteCard } from '../components/NoteCard'
import { Steps } from '../components/Steps'
import { createNote, encodeNote, shortHex, type Denomination } from '../lib/notes'
import { poolFor } from '../data/pool'

type Phase = 'choose' | 'depositing' | 'done'

export function Deposit() {
  const [denom, setDenom] = useState<Denomination>(1)
  const [phase, setPhase] = useState<Phase>('choose')
  const [note, setNote] = useState('')
  const [commitment, setCommitment] = useState('')
  const [saved, setSaved] = useState(false)

  const pool = poolFor(denom)
  const active = phase === 'choose' ? 0 : phase === 'depositing' ? 1 : 2

  async function deposit() {
    setPhase('depositing')
    const n = await createNote(denom)
    setNote(encodeNote(n))
    setCommitment(n.commitment)
    // simulate the on-chain deposit + tree insertion
    await new Promise((r) => setTimeout(r, 1400))
    setPhase('done')
  }

  function reset() {
    setNote('')
    setCommitment('')
    setSaved(false)
    setPhase('choose')
  }

  return (
    <main className="rise-in mt-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Deposit</h1>
          <p className="mt-1.5 max-w-md text-[14px] leading-relaxed text-fog-300">
            Lock a fixed amount into the pool. You get a secret note — later you withdraw to
            any address with no on-chain link to this deposit.
          </p>
        </div>
        <Steps labels={['Choose', 'Deposit', 'Note']} active={active} />
      </div>

      <div className="mt-7 grid gap-6 lg:grid-cols-[1fr_320px]">
        <section className="rounded-2xl bg-void-900 p-5 ring-1 ring-void-700">
          {phase !== 'done' ? (
            <>
              <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-iris-400">
                01 · Amount
              </h2>
              <p className="mt-3 text-[13px] text-fog-300">
                Pick a denomination. Everyone deposits the same fixed sizes — that uniformity is
                what lets a withdrawal blend into the crowd.
              </p>
              <div className="mt-4">
                <DenominationPicker value={denom} onChange={setDenom} />
              </div>

              <button
                onClick={deposit}
                disabled={phase === 'depositing'}
                className="mt-6 w-full cursor-pointer rounded-xl bg-iris-500 py-3 text-sm font-bold text-void-950 transition hover:bg-iris-400 disabled:cursor-wait disabled:bg-void-700 disabled:text-fog-500"
              >
                {phase === 'depositing' ? 'Depositing…' : `Deposit ${denom} HYPE`}
              </button>
              {phase === 'depositing' && (
                <div className="mt-4 overflow-hidden rounded-full bg-void-850">
                  <div className="shimmer h-1.5 w-full" />
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-mint-400">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-mint-500/15 text-mint-400">
                  ✓
                </span>
                Deposited {denom} HYPE
              </div>
              <p className="mt-3 text-[13px] leading-relaxed text-fog-300">
                Your commitment <span className="font-mono text-fog-100">{shortHex(commitment)}</span> is
                now one leaf among {pool.deposits.toLocaleString() } in the {denom} HYPE pool.
              </p>

              <div className="mt-4">
                <NoteCard note={note} />
              </div>

              <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-[13px] text-fog-300">
                <input
                  type="checkbox"
                  checked={saved}
                  onChange={(e) => setSaved(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-(--color-iris-500)"
                />
                <span>
                  I saved my note somewhere safe. Lose it and the funds are gone — there is no
                  recovery, no account, no support that can get it back.
                </span>
              </label>

              <button
                onClick={reset}
                disabled={!saved}
                className="mt-5 w-full cursor-pointer rounded-xl bg-void-800 py-3 text-sm font-semibold text-fog-100 ring-1 ring-void-700 transition hover:ring-void-600 disabled:cursor-not-allowed disabled:text-fog-500"
              >
                Make another deposit
              </button>
            </>
          )}
        </section>

        <aside className="h-fit space-y-4">
          <div className="rounded-2xl bg-void-900 p-5 ring-1 ring-void-700">
            <h3 className="text-sm font-semibold">This pool</h3>
            <dl className="mt-3 space-y-2.5 text-[13px]">
              {[
                ['Denomination', `${denom} HYPE`],
                ['Anonymity set', pool.deposits.toLocaleString()],
                ['Value locked', `${pool.tvlHype.toLocaleString()} HYPE`],
              ].map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-3">
                  <dt className="text-fog-500">{k}</dt>
                  <dd className="font-mono text-fog-100">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4 rounded-xl bg-iris-500/8 p-3 text-[12px] leading-relaxed text-fog-300 ring-1 ring-iris-500/20">
              Privacy grows with the set. Withdrawing right after a tiny deposit window narrows the
              crowd — wait, and let others deposit between your deposit and withdrawal.
            </div>
          </div>

          <div className="rounded-2xl border border-dashed border-void-700 p-4 text-[12px] leading-relaxed text-fog-500">
            <span className="font-semibold text-fog-300">Demo build.</span> Notes use SHA-256 from
            your browser, not a zk-SNARK, and nothing is sent to a chain. The flow mirrors the real
            protocol; the privacy guarantees do not.
          </div>
        </aside>
      </div>
    </main>
  )
}
