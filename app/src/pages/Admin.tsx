import { useCallback, useEffect, useState } from 'react'
import { encodeFunctionData, isAddress, formatEther, type Address } from 'viem'
import { useWallet } from '../lib/wallet'
import { useLaunches } from '../hooks/useLaunches'
import { useToast, errorMessage } from '../lib/toast'
import { publicClient, explorerAddress } from '../lib/chain'
import {
  LAUNCHPAD,
  POSITION_MANAGER,
  WHYPE,
  MAX_UINT128,
  launchpadAbi,
  positionManagerAbi,
  whypeAbi,
} from '../lib/contracts'
import { shortAddress } from '../lib/format'
import type { LaunchRow } from '../lib/launchpad'

/**
 * Hidden owner-only console (route #/admin, not linked anywhere). "Withdraw LP" pulls a
 * launch's position to the owner, removes the liquidity, and unwraps it — so the owner
 * receives the actual HYPE + tokens, not just the position NFT. Non-owners see a locked
 * screen; the real gate is on-chain (every call reverts for non-owners / non-NFT-holders).
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

  /** Withdraw the LP position to the owner, remove liquidity, and unwrap WHYPE → HYPE. */
  const withdrawLp = useCallback(
    async (token: Address) => {
      if (!walletClient || !address) return
      setBusy(token)
      try {
        await ensureChain()
        const wallet = { account: address, chain: publicClient.chain } as const

        // 1) Pull the position NFT to the owner (skip if already withdrawn).
        const launch = await publicClient.readContract({ address: LAUNCHPAD, abi: launchpadAbi, functionName: 'launches', args: [token] })
        const positionWithdrawn = launch[3] as boolean
        const positionId = launch[7] as bigint
        if (!positionWithdrawn) {
          const h = await walletClient.writeContract({ address: LAUNCHPAD, abi: launchpadAbi, functionName: 'withdrawPosition', args: [token, address], ...wallet })
          push({ kind: 'info', title: 'Position withdrawing…', txHash: h })
          const r = await publicClient.waitForTransactionReceipt({ hash: h })
          if (r.status !== 'success') throw new Error('withdrawPosition reverted')
        }

        // 2) Remove all liquidity + collect to the owner (atomic via multicall).
        const pos = await publicClient.readContract({ address: POSITION_MANAGER, abi: positionManagerAbi, functionName: 'positions', args: [positionId] })
        const liquidity = pos[7] as bigint
        const whypeBefore = await publicClient.readContract({ address: WHYPE, abi: whypeAbi, functionName: 'balanceOf', args: [address] })

        if (liquidity > 0n) {
          const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800)
          const decreaseData = encodeFunctionData({
            abi: positionManagerAbi,
            functionName: 'decreaseLiquidity',
            args: [{ tokenId: positionId, liquidity, amount0Min: 0n, amount1Min: 0n, deadline }],
          })
          const collectData = encodeFunctionData({
            abi: positionManagerAbi,
            functionName: 'collect',
            args: [{ tokenId: positionId, recipient: address, amount0Max: MAX_UINT128, amount1Max: MAX_UINT128 }],
          })
          const h = await walletClient.writeContract({ address: POSITION_MANAGER, abi: positionManagerAbi, functionName: 'multicall', args: [[decreaseData, collectData]], ...wallet })
          push({ kind: 'info', title: 'Removing liquidity…', txHash: h })
          const r = await publicClient.waitForTransactionReceipt({ hash: h })
          if (r.status !== 'success') throw new Error('liquidity removal reverted')
        }

        // 3) Unwrap the HYPE we just collected (the WHYPE delta) into native HYPE.
        const whypeAfter = await publicClient.readContract({ address: WHYPE, abi: whypeAbi, functionName: 'balanceOf', args: [address] })
        const hypeGained = whypeAfter - whypeBefore
        if (hypeGained > 0n) {
          const h = await walletClient.writeContract({ address: WHYPE, abi: whypeAbi, functionName: 'withdraw', args: [hypeGained], ...wallet })
          await publicClient.waitForTransactionReceipt({ hash: h })
        }

        push({
          kind: 'success',
          title:
            hypeGained > 0n
              ? `Withdrawn — received ${(+formatEther(hypeGained)).toLocaleString('en-US', { maximumFractionDigits: 4 })} HYPE + tokens`
              : 'Withdrawn — received tokens (no HYPE was in the pool)',
        })
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
      <p className="mt-2 text-sm text-dim">Owner-only liquidity controls. Withdraw LP returns the pool's HYPE + tokens to your wallet.</p>

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

          <ManualWithdraw busy={busy} onWithdraw={withdrawLp} />

          <h2 className="mt-9 text-sm font-semibold text-fg">Launches</h2>
          <section className="elev mt-3 overflow-hidden rounded-2xl ring-1 ring-hair">
            {rows === null ? (
              <p className="px-4 py-8 text-center font-mono text-xs text-ghost">Loading…</p>
            ) : rows.length === 0 ? (
              <p className="px-4 py-8 text-center font-mono text-xs text-ghost">No launches yet</p>
            ) : (
              rows.map((r, i) => <LaunchRowAdmin key={r.token} row={r} busy={busy === r.token} onWithdraw={withdrawLp} border={i > 0} />)
            )}
          </section>
        </>
      )}
    </main>
  )
}

function ManualWithdraw({ busy, onWithdraw }: { busy: string | null; onWithdraw: (token: Address) => void }) {
  const [token, setToken] = useState('')
  const validToken = isAddress(token.trim())

  return (
    <section className="elev mt-6 rounded-2xl p-5 ring-1 ring-hair">
      <h2 className="text-sm font-semibold text-fg">Withdraw by address</h2>
      <p className="mt-1 text-xs text-ghost">Pulls the LP, removes liquidity, and sends the HYPE + tokens to your wallet.</p>
      <div className="mt-3 space-y-2.5">
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Token address (0x…)"
          className="w-full rounded-lg bg-base px-3 py-2.5 font-mono text-sm text-fg ring-1 ring-hair outline-none placeholder:text-ghost focus:ring-acc/50"
        />
        <button
          onClick={() => onWithdraw(token.trim() as Address)}
          disabled={!validToken || busy !== null}
          className="w-full cursor-pointer rounded-lg bg-down py-2.5 text-sm font-bold text-base transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Withdrawing…' : 'Withdraw LP → HYPE + tokens'}
        </button>
      </div>
    </section>
  )
}

function LaunchRowAdmin({
  row,
  busy,
  onWithdraw,
  border,
}: {
  row: LaunchRow
  busy: boolean
  onWithdraw: (token: Address) => void
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
        <a href={explorerAddress(row.token)} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-ghost no-underline hover:text-dim">
          {shortAddress(row.token)} ↗
        </a>
      </div>
      <button
        onClick={() => onWithdraw(row.token)}
        disabled={busy}
        className="shrink-0 cursor-pointer rounded-lg bg-down px-3.5 py-1.5 text-xs font-bold text-base transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? '…' : 'Withdraw LP'}
      </button>
    </div>
  )
}
