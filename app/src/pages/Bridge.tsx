import { useState } from 'react'
import { useAccount, useBalance, useSwitchChain, useChainId, useConnect, useDisconnect } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { formatUnits } from 'viem'
import { mainnet, BRIDGE_TOKENS } from '../lib/chains'

type Token = (typeof BRIDGE_TOKENS)[number]

const STEPS = ['Approve token', 'Initiate bridge', 'Wait for relay (~15 min)', 'Done']

export function Bridge() {
  const [amount, setAmount] = useState('')
  const [selectedToken, setSelectedToken] = useState<Token>(BRIDGE_TOKENS[0])
  const [showTokenMenu, setShowTokenMenu] = useState(false)
  const [bridgeStep, setBridgeStep] = useState<number | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)

  const { address, isConnected } = useAccount()
  const { connect } = useConnect()
  const { disconnect } = useDisconnect()
  const chainId = useChainId()
  const { switchChain, isPending: isSwitching } = useSwitchChain()

  const { data: ethBalance } = useBalance({
    address,
    chainId: mainnet.id,
  })

  const balance = selectedToken.symbol === 'ETH' ? ethBalance : null
  const displayBalance = balance ? parseFloat(formatUnits(balance.value, balance.decimals)).toFixed(4) : '—'

  const isOnMainnet = chainId === mainnet.id
  const parsedAmount = amount ? parseFloat(amount) : 0
  const hasInsufficientBalance =
    balance && parsedAmount > 0
      ? parsedAmount > parseFloat(formatUnits(balance.value, balance.decimals))
      : false

  function handleMaxClick() {
    if (!balance) return
    setAmount(formatUnits(balance.value, balance.decimals))
  }

  function handleBridge() {
    if (!isConnected || !isOnMainnet || !amount || hasInsufficientBalance) return
    setBridgeStep(0)
    // Simulate step progression (real impl would listen to contract events)
    if (selectedToken.symbol !== 'ETH') {
      simulateStep(0, 2000)
    } else {
      simulateStep(1, 0)
    }
  }

  function simulateStep(step: number, delay: number) {
    setTimeout(() => {
      setBridgeStep(step)
      if (step === 1) {
        setTxHash('0x' + Math.random().toString(16).slice(2).repeat(4).slice(0, 64))
        setTimeout(() => setBridgeStep(2), 1500)
      }
    }, delay)
  }

  function handleReset() {
    setBridgeStep(null)
    setTxHash(null)
    setAmount('')
  }

  const ctaDisabled =
    !isConnected ||
    !amount ||
    parsedAmount <= 0 ||
    hasInsufficientBalance ||
    bridgeStep !== null

  return (
    <div className="mx-auto mt-10 max-w-lg">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Bridge</h1>
        <p className="mt-1 text-sm text-fog-400">Transfer tokens from Ethereum Mainnet to Robinhood Chain</p>
      </div>

      {/* Main card */}
      <div className="rounded-2xl bg-ink-850/60 p-6 ring-1 ring-ink-700">

        {/* Chain route */}
        <div className="mb-5 flex items-center gap-3">
          <ChainPill name="Ethereum" color="blue" />
          <svg className="h-4 w-4 shrink-0 text-fog-500" viewBox="0 0 16 16" fill="none">
            <path d="M2 8h12M10 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <ChainPill name="Robinhood Chain" color="green" />
        </div>

        {/* Token + Amount input */}
        <div className="mb-4 rounded-xl bg-ink-900/60 p-4 ring-1 ring-ink-700">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs text-fog-500">You send</span>
            <div className="flex items-center gap-1.5 text-xs text-fog-500">
              <span>Balance: {displayBalance}</span>
              {balance && (
                <button
                  onClick={handleMaxClick}
                  className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-mint-400 ring-1 ring-mint-500/30 hover:bg-mint-500/10"
                >
                  Max
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Token selector */}
            <div className="relative">
              <button
                onClick={() => setShowTokenMenu((v) => !v)}
                className="flex items-center gap-2 rounded-xl bg-ink-800 px-3 py-2 ring-1 ring-ink-600 hover:ring-fog-600 transition"
              >
                <span className="text-sm font-semibold">{selectedToken.symbol}</span>
                <svg className="h-3.5 w-3.5 text-fog-500" viewBox="0 0 12 12" fill="none">
                  <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              {showTokenMenu && (
                <div className="absolute left-0 top-full z-20 mt-1 w-44 rounded-xl bg-ink-800 py-1 shadow-xl ring-1 ring-ink-600">
                  {BRIDGE_TOKENS.map((t) => (
                    <button
                      key={t.symbol}
                      onClick={() => { setSelectedToken(t); setShowTokenMenu(false) }}
                      className={`flex w-full items-center gap-2.5 px-3 py-2 text-sm transition hover:bg-ink-700 ${t.symbol === selectedToken.symbol ? 'text-mint-300' : 'text-fog-200'}`}
                    >
                      <span className="font-semibold">{t.symbol}</span>
                      <span className="text-fog-500 text-xs">{t.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Amount input */}
            <input
              type="number"
              min="0"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="flex-1 bg-transparent text-right text-xl font-semibold text-fog-100 outline-none placeholder:text-fog-700"
            />
          </div>

          {hasInsufficientBalance && (
            <p className="mt-1.5 text-right text-xs text-red-400">Insufficient balance</p>
          )}
        </div>

        {/* Receive row */}
        <div className="mb-5 rounded-xl bg-ink-900/40 px-4 py-3 ring-1 ring-ink-700/50">
          <div className="flex items-center justify-between">
            <span className="text-xs text-fog-500">You receive on Robinhood Chain</span>
            <span className="text-sm font-semibold text-fog-100">
              {amount && parsedAmount > 0 ? `~${parsedAmount.toFixed(4)} ${selectedToken.symbol}` : '—'}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-xs text-fog-600">Est. time</span>
            <span className="text-xs text-fog-400">~15 minutes</span>
          </div>
        </div>

        {/* Bridge progress */}
        {bridgeStep !== null && (
          <BridgeProgress step={bridgeStep} txHash={txHash} onReset={handleReset} />
        )}

        {/* CTA buttons */}
        {bridgeStep === null && (
          <>
            {!isConnected ? (
              <button
                onClick={() => connect({ connector: injected() })}
                className="w-full rounded-xl bg-mint-500 py-3 text-sm font-semibold text-ink-950 transition hover:bg-mint-400"
              >
                Connect Wallet
              </button>
            ) : !isOnMainnet ? (
              <button
                onClick={() => switchChain({ chainId: mainnet.id })}
                disabled={isSwitching}
                className="w-full rounded-xl bg-amber-500/20 py-3 text-sm font-semibold text-amber-300 ring-1 ring-amber-500/30 transition hover:bg-amber-500/30 disabled:opacity-60"
              >
                {isSwitching ? 'Switching…' : 'Switch to Ethereum Mainnet'}
              </button>
            ) : (
              <button
                onClick={handleBridge}
                disabled={ctaDisabled}
                className="w-full rounded-xl bg-mint-500 py-3 text-sm font-semibold text-ink-950 transition hover:bg-mint-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {hasInsufficientBalance ? 'Insufficient Balance' : selectedToken.symbol !== 'ETH' ? 'Approve & Bridge' : 'Bridge to Robinhood Chain'}
              </button>
            )}
          </>
        )}

        {/* Connected wallet */}
        {isConnected && (
          <div className="mt-3 flex items-center justify-between">
            <span className="font-mono text-xs text-fog-600">
              {address?.slice(0, 6)}…{address?.slice(-4)}
            </span>
            <button
              onClick={() => disconnect()}
              className="text-xs text-fog-600 hover:text-fog-300 transition"
            >
              Disconnect
            </button>
          </div>
        )}
      </div>

      {/* Info panel */}
      <div className="mt-4 rounded-xl bg-ink-850/40 p-4 ring-1 ring-ink-700/50">
        <p className="text-xs font-semibold uppercase tracking-wider text-fog-600 mb-2">About Robinhood Chain</p>
        <ul className="space-y-1.5 text-xs text-fog-500">
          <li className="flex gap-2"><span className="text-mint-500">→</span> Ethereum L2 built on Arbitrum Orbit technology</li>
          <li className="flex gap-2"><span className="text-mint-500">→</span> Low fees, fast finality (~2 sec block time)</li>
          <li className="flex gap-2"><span className="text-mint-500">→</span> Chain ID: 1996 · Native token: ETH</li>
          <li className="flex gap-2"><span className="text-mint-500">→</span> Bridged assets arrive within ~15 minutes</li>
        </ul>
      </div>
    </div>
  )
}

function ChainPill({ name, color }: { name: string; color: 'blue' | 'green' }) {
  const colors = {
    blue: 'bg-blue-500/10 text-blue-300 ring-blue-500/20',
    green: 'bg-mint-500/10 text-mint-300 ring-mint-500/20',
  }
  return (
    <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 ring-1 text-xs font-medium ${colors[color]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${color === 'blue' ? 'bg-blue-400' : 'bg-mint-400'}`} />
      {name}
    </div>
  )
}

function BridgeProgress({ step, txHash, onReset }: { step: number; txHash: string | null; onReset: () => void }) {
  const isDone = step >= 3

  return (
    <div className="mb-5 rounded-xl bg-ink-900/60 p-4 ring-1 ring-ink-700">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold">{isDone ? 'Bridge complete' : 'Bridging in progress…'}</span>
        {isDone && (
          <button onClick={onReset} className="text-xs text-fog-500 hover:text-fog-300 transition">
            New transfer
          </button>
        )}
      </div>

      <ol className="space-y-2">
        {STEPS.map((label, i) => {
          const done = step > i
          const active = step === i
          return (
            <li key={i} className="flex items-center gap-2.5 text-xs">
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold transition-colors ${done ? 'bg-mint-500 text-ink-950' : active ? 'bg-mint-500/20 text-mint-300 ring-1 ring-mint-500/50' : 'bg-ink-800 text-fog-600'}`}>
                {done ? '✓' : i + 1}
              </span>
              <span className={done ? 'text-fog-300' : active ? 'text-fog-100 font-medium' : 'text-fog-600'}>
                {label}
              </span>
            </li>
          )
        })}
      </ol>

      {txHash && (
        <div className="mt-3 rounded-lg bg-ink-800 px-3 py-2">
          <span className="text-xs text-fog-500">Tx: </span>
          <span className="font-mono text-xs text-fog-300">{txHash.slice(0, 20)}…</span>
          <a
            href={`https://etherscan.io/tx/${txHash}`}
            target="_blank"
            rel="noreferrer"
            className="ml-2 text-xs text-mint-400 hover:text-mint-300"
          >
            View ↗
          </a>
        </div>
      )}
    </div>
  )
}
