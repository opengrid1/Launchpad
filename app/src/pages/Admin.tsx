import { useCallback, useEffect, useState } from 'react'
import { isAddress, type Address } from 'viem'
import { useWallet } from '../lib/wallet'
import { useLaunches } from '../hooks/useLaunches'
import { useToast, errorMessage } from '../lib/toast'
import { publicClient, explorerAddress } from '../lib/chain'
import { LAUNCHPAD, launchpadAbi } from '../lib/contracts'
import { shortAddress } from '../lib/format'
import type { LaunchRow } from '../lib/launchpad'

/**
 * Hidden owner-only console (route #/admin, not linked anywhere). Lets the contract
 * owner withdraw a launch's LP position via `withdrawPosition`. Anyone else sees a
 * locked screen — the real gate is on-chain (the call reverts for non-owners), this
 * is just to keep the controls out of sight.
 */
export function AdminPage() {
  const { address, walletClient, connect, ensureChain, onCorrectChain, chainId } = useWallet()
  const { rows, refresh } = useLaunches()
  const { push } = useToast()
  const [owner, setOwner] = useState<Address | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void publicClient
      .readContract({ address: LAUNCHPAD, abi: launchpadAbi, functionName: 'owner' })
      .then((o) => alive && setOwner(o))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const isOwner = !!address && !!owner && address.toLowerCase() === owner.toLowerCase()

  const withdraw = useCallback(
    async (token: Address, recipient: Address) => {
      if (!walletClient || !address) return
      setBusy(token)
      try {
        await ensureChain()
        const hash = await walletClient.writeContract({
          address: LAUNCHPAD,
          abi: launchpadAbi,
          functionName: 'withdrawPosition',
          args: [token, recipient],
          account: address,
          chain: publicClient.chain,
        })
        push({ kind: 'info', title: 'Withdraw submitted', txHash: hash })
        const receipt = await publicClient.waitForTransactionReceipt({ hash })
        push(
          receipt.status === 'success'
            ? { kind: 'success', title: 'LP withdrawn', txHash: hash }
            : { kind: 'error', title: 'Withdraw reverted', txHash: hash },
        )
        await refresh()
      } catch (err) {
        push({ kind: 'error', title: 'Withdraw failed', detail: errorMessage(err) })
      } finally {
        setBusy(null)
      }
    },
    [walletClient, address, ensureChain, push, refresh],
  )

  return (
    <main className="mx-auto mt-10 max-w-2xl pb-10">
      <h1 className="text-2xl font-semibold tracking-tight text-fg">Admin</h1>
      <p className="mt-2 text-sm text-dim">Owner-only liquidity controls.</p>

      {!address ? (
        <div className="elev mt-8 rounded-2xl p-8 text-center ring-1 ring-hair">
          <p className="text-sm text-ghost">Connect the owner wallet to continue.</p>
          <button onClick={() => void connect()} className="btn-primary mt-4 cursor-pointer rounded-lg px-5 py-2.5 text-sm font-semibold">
            Connect
          </button>
        </div>
      ) : !isOwner ? (
        <div className="elev mt-8 rounded-2xl p-8 text-center ring-1 ring-hair">
          <p className="font-mono text-sm text-down">Not authorized</p>
          <p className="mt-1 font-mono text-xs text-ghost">{shortAddress(address)}</p>
        </div>
      ) : (
        <>
          {address && !onCorrectChain && chainId !== null && (
            <button onClick={() => void ensureChain()} className="mt-6 cursor-pointer rounded-lg bg-downsoft px-3 py-2 text-xs font-bold text-down">
              Switch to HyperEVM
            </button>
          )}

          <ManualWithdraw owner={owner!} busy={busy} onWithdraw={withdraw} />

          <h2 className="mt-9 text-sm font-semibold text-fg">Launches</h2>
          <section className="elev mt-3 overflow-hidden rounded-2xl ring-1 ring-hair">
            {rows === null ? (
              <p className="px-4 py-8 text-center font-mono text-xs text-ghost">Loading…</p>
            ) : rows.length === 0 ? (
              <p className="px-4 py-8 text-center font-mono text-xs text-ghost">No launches yet</p>
            ) : (
              rows.map((r, i) => (
                <LaunchRowAdmin key={r.token} row={r} owner={owner!} busy={busy === r.token} onWithdraw={withdraw} border={i > 0} />
              ))
            )}
          </section>
        </>
      )}
    </main>
  )
}

function ManualWithdraw({
  owner,
  busy,
  onWithdraw,
}: {
  owner: Address
  busy: string | null
  onWithdraw: (token: Address, recipient: Address) => void
}) {
  const [token, setToken] = useState('')
  const [recipient, setRecipient] = useState<string>(owner)
  const validToken = isAddress(token.trim())
  const validRecipient = isAddress(recipient.trim())

  return (
    <section className="elev mt-6 rounded-2xl p-5 ring-1 ring-hair">
      <h2 className="text-sm font-semibold text-fg">Withdraw by address</h2>
      <div className="mt-3 space-y-2.5">
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Token address (0x…)"
          className="w-full rounded-lg bg-base px-3 py-2.5 font-mono text-sm text-fg ring-1 ring-hair outline-none placeholder:text-ghost focus:ring-acc/50"
        />
        <input
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder="Recipient (0x…)"
          className="w-full rounded-lg bg-base px-3 py-2.5 font-mono text-sm text-fg ring-1 ring-hair outline-none placeholder:text-ghost focus:ring-acc/50"
        />
        <button
          onClick={() => onWithdraw(token.trim() as Address, recipient.trim() as Address)}
          disabled={!validToken || !validRecipient || busy !== null}
          className="w-full cursor-pointer rounded-lg bg-down py-2.5 text-sm font-bold text-base transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Withdrawing…' : 'Withdraw LP'}
        </button>
      </div>
    </section>
  )
}

function LaunchRowAdmin({
  row,
  owner,
  busy,
  onWithdraw,
  border,
}: {
  row: LaunchRow
  owner: Address
  busy: boolean
  onWithdraw: (token: Address, recipient: Address) => void
  border: boolean
}) {
  return (
    <div className={`flex items-center justify-between gap-3 px-4 py-3 ${border ? 'border-t border-hair' : ''}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-fg">{row.name}</span>
          <span className="font-mono text-xs text-ghost">${row.symbol}</span>
          {row.positionWithdrawn && (
            <span className="rounded bg-downsoft px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-down">withdrawn</span>
          )}
        </div>
        <a
          href={explorerAddress(row.token)}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[11px] text-ghost no-underline hover:text-dim"
        >
          {shortAddress(row.token)} ↗
        </a>
      </div>
      <button
        onClick={() => onWithdraw(row.token, owner)}
        disabled={row.positionWithdrawn || busy}
        className="shrink-0 cursor-pointer rounded-lg bg-down px-3.5 py-1.5 text-xs font-bold text-base transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? '…' : row.positionWithdrawn ? 'Withdrawn' : 'Withdraw'}
      </button>
    </div>
  )
}
