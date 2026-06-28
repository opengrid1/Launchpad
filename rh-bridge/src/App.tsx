import { useState, useEffect } from 'react'
import {
  useAccount, useBalance, useSendTransaction,
  useWaitForTransactionReceipt, useSwitchChain, useChainId,
} from 'wagmi'
import { useAppKit } from '@reown/appkit/react'
import { parseEther, formatEther } from 'viem'
import { mainnet } from './wagmiConfig'

const RH_CHAIN_ID    = 4663
const BRIDGE_ADDRESS = '0x5dddea56774f01fc9d207bbd7b7633596a2f4a0b' as `0x${string}`
const LIQUIDITY_DEPOSIT   = 34.7502
const LIQUIDITY_WITHDRAW  = 34.7502
const MAX_PER_TX_DEPOSIT  = 27.8002
const MAX_PER_TX_WITHDRAW = 27.8002
const STATUS: string = 'Online'

function EthLogo({ cls = 'w-6 h-6' }: { cls?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={`${cls} shrink-0 rounded-full`} fill="none">
      <circle cx="16" cy="16" r="16" fill="#627EEA"/>
      <path d="M16.5 4v8.87l7.5 3.35-7.5-12.22z" fill="white" fillOpacity=".6"/>
      <path d="M16.5 4L9 16.22l7.5-3.35V4z" fill="white"/>
      <path d="M16.5 21.97v5.68l7.52-10.4-7.52 4.72z" fill="white" fillOpacity=".6"/>
      <path d="M16.5 27.65v-5.68L9 17.25l7.5 10.4z" fill="white"/>
      <path d="M16.5 20.07l7.5-4.22-7.5 3.24-7.5-3.24 7.5 4.22z" fill="white" fillOpacity=".2"/>
    </svg>
  )
}

function RHLogo({ cls = 'w-6 h-6' }: { cls?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={`${cls} shrink-0 rounded-full`} fill="none">
      <circle cx="16" cy="16" r="16" fill="#1a0403"/>
      <text x="50%" y="56%" dominantBaseline="middle" textAnchor="middle" fontSize="15" fill="#f7c243" fontWeight="bold" fontFamily="Inter,sans-serif">R</text>
    </svg>
  )
}

export default function App() {
  const [tab, setTab]       = useState<'deposit'|'withdraw'>('deposit')
  const [amount, setAmount] = useState('')
  const [step, setStep]     = useState<'idle'|'bridging'|'done'>('idle')

  const { address, isConnected } = useAccount()
  const { open }   = useAppKit()
  const chainId    = useChainId()
  const { switchChain, isPending: switching } = useSwitchChain()

  const srcChainId = tab === 'deposit' ? mainnet.id : RH_CHAIN_ID
  const onSrcChain = chainId === srcChainId

  const { data: balData, refetch: refetchBal } = useBalance({
    address, chainId: srcChainId, query: { enabled: !!address },
  })
  const { data: dstBalData } = useBalance({
    address, chainId: tab === 'deposit' ? RH_CHAIN_ID : mainnet.id, query: { enabled: !!address },
  })

  const balance    = balData    ? +formatEther(balData.value)    : null
  const dstBalance = dstBalData ? +formatEther(dstBalData.value) : null
  const parsed     = parseFloat(amount) || 0
  const tooMuch    = balance != null && parsed > balance
  const canBridge  = isConnected && onSrcChain && parsed > 0 && !tooMuch && step === 'idle'

  const { sendTransaction: doBridge, data: bridgeTx } = useSendTransaction()
  const { isSuccess: bridgeOk } = useWaitForTransactionReceipt({ hash: bridgeTx })

  useEffect(() => {
    if (!bridgeOk || step !== 'bridging') return
    refetchBal(); setStep('done')
  }, [bridgeOk])

  useEffect(() => { setAmount(''); setStep(step === 'done' ? 'idle' : step) }, [tab])

  function submit() {
    if (!canBridge) return
    setStep('bridging')
    doBridge({ to: BRIDGE_ADDRESS, value: parseEther(parsed.toFixed(18)), chainId: srcChainId })
  }

  function handleCta() {
    if (!isConnected)    return open()
    if (!onSrcChain)     return switchChain({ chainId: srcChainId })
    if (step === 'done') { setStep('idle'); setAmount(''); return }
    submit()
  }

  const ctaLabel = (): string => {
    if (!isConnected)        return 'Connect wallet'
    if (!onSrcChain)         return switching ? 'Switching…' : `Switch to ${tab === 'deposit' ? 'Ethereum' : 'Robinhood Chain'}`
    if (step === 'done')     return 'Bridge again'
    if (step === 'bridging') return 'Confirm in wallet…'
    if (!parsed)             return 'Enter an amount'
    if (tooMuch)             return 'Insufficient balance'
    return tab === 'deposit'
      ? `Deposit ${parsed.toLocaleString('en', { maximumFractionDigits: 6 })} ETH`
      : `Withdraw ${parsed.toLocaleString('en', { maximumFractionDigits: 6 })} ETH`
  }

  const ctaEnabled = step !== 'bridging' && (!isConnected || !onSrcChain || step === 'done' || canBridge)

  const fmtBal = (b: number | null) =>
    b != null ? b.toLocaleString('en', { maximumFractionDigits: 4 }) : '0'

  const srcName = tab === 'deposit' ? 'Base' : 'Robinhood'
  const dstName = tab === 'deposit' ? 'Robinhood' : 'Base'

  return (
    <div className="min-h-screen bg-background text-foreground relative overflow-hidden">

      {/* Background glow + grid */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute top-[-15%] left-1/2 -translate-x-1/2 w-[80rem] h-[40rem] rounded-full bg-brand/15 blur-[140px]" />
        <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: 'linear-gradient(var(--color-brand) 1px, transparent 1px), linear-gradient(90deg, var(--color-brand) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
      </div>

      {/* Header */}
      <header className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-end gap-4">
        <button
          onClick={() => open()}
          className="inline-flex shrink-0 items-center gap-2 rounded-full bg-brand text-brand-foreground px-4 py-2 text-sm font-semibold hover:opacity-90 transition"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/>
            <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>
          </svg>
          {isConnected && address ? `${address.slice(0,6)}…${address.slice(-4)}` : 'Connect'}
        </button>
      </header>

      {/* Main */}
      <main className="max-w-md mx-auto px-4 pt-2 pb-16">

        {/* Logo */}
        <img
          src="/esafr-logo.png"
          alt="ESAFR Bridge"
          className="mx-auto mb-4 w-full max-w-sm select-none drop-shadow-[0_10px_40px_rgba(0,0,0,0.6)]"
          draggable={false}
        />

        {/* Bridge card */}
        <div className="rounded-3xl bg-surface-2 ring-1 ring-white/10 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)] p-4 space-y-3 backdrop-blur">

          {/* Card header */}
          <div className="flex items-center justify-between px-2 pt-1">
            <h1 className="text-base font-semibold">Bridge</h1>
            <button className="p-1.5 rounded-md transition text-muted-foreground hover:text-foreground" aria-label="Advanced">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M14 17H5"/><path d="M19 7h-9"/>
                <circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>
              </svg>
            </button>
          </div>

          {/* YOU PAY */}
          <div className="rounded-2xl bg-surface ring-1 ring-white/5 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">You pay</span>
              <button
                type="button"
                onClick={() => balance && setAmount(balance.toFixed(6))}
                className="text-xs text-muted-foreground hover:text-brand transition"
              >
                Balance: <span className="font-mono text-foreground">{fmtBal(balance)}</span>
              </button>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
              <input
                type="number"
                inputMode="decimal"
                placeholder="0.0"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                className="block w-full min-w-0 bg-transparent border-0 outline-none text-3xl font-semibold tabular-nums text-foreground placeholder:text-white/20"
              />
              <button
                type="button"
                className="flex items-center gap-2 shrink-0 rounded-full bg-white/5 ring-1 ring-white/10 pl-2 pr-4 py-1.5 hover:bg-white/10 transition"
              >
                {tab === 'deposit' ? <EthLogo/> : <RHLogo/>}
                <div className="flex flex-col leading-tight text-left">
                  <span className="text-sm font-semibold text-foreground">{srcName}</span>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">ETH</span>
                </div>
              </button>
            </div>
          </div>

          {/* Arrow */}
          <div className="relative h-0">
            <button
              type="button"
              aria-label="Flip direction"
              onClick={() => setTab(tab === 'deposit' ? 'withdraw' : 'deposit')}
              className="absolute left-1/2 -translate-x-1/2 -top-5 z-10 w-10 h-10 rounded-xl bg-surface-2 ring-4 ring-background grid place-items-center hover:bg-surface transition group"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground group-hover:text-brand transition" aria-hidden="true">
                <path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>
              </svg>
            </button>
          </div>

          {/* YOU RECEIVE */}
          <div className="rounded-2xl bg-surface ring-1 ring-white/5 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">You receive</span>
              <span className="text-xs text-muted-foreground">
                Balance: <span className="font-mono text-foreground">{fmtBal(dstBalance)}</span>
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0 text-3xl font-semibold tabular-nums truncate">
                <span className={parsed > 0 ? 'text-foreground' : 'text-white/20'}>
                  {parsed > 0 ? parsed.toLocaleString('en', { maximumFractionDigits: 6 }) : '0.0'}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2 rounded-full bg-white/5 ring-1 ring-white/10 pl-2 pr-3 py-1.5">
                {tab === 'deposit' ? <RHLogo/> : <EthLogo/>}
                <div className="flex flex-col leading-tight text-left">
                  <span className="text-sm font-semibold text-foreground">{dstName}</span>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">ETH</span>
                </div>
              </div>
            </div>
          </div>

          {/* CTA */}
          <button
            onClick={handleCta}
            disabled={!ctaEnabled}
            className="w-full h-14 rounded-2xl bg-brand text-brand-foreground font-semibold text-base hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {step === 'bridging' && (
              <span className="w-4 h-4 border-2 border-brand-foreground border-t-transparent rounded-full" style={{ animation: 'spin 0.7s linear infinite' }} />
            )}
            {ctaLabel()}
          </button>
        </div>

        {/* Footer links */}
        <div className="mt-4 flex items-center justify-between px-2 text-[11px] text-muted-foreground">
          <button
            onClick={() => switchChain({ chainId: RH_CHAIN_ID })}
            className="inline-flex items-center gap-1 hover:text-brand transition"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14"/><path d="M12 5v14"/>
            </svg>
            Add Robinhood Chain
          </button>
          <span>RobinBridge · powered by <span className="text-foreground">Relay</span></span>
        </div>

        {/* Liquidity card */}
        <div className="mt-4 rounded-2xl bg-surface-2 ring-1 ring-white/10 p-4 space-y-1">
          <div className="flex items-center gap-2 mb-2">
            <div className={`w-2 h-2 rounded-full shrink-0 ${STATUS === 'Online' ? 'bg-green-400' : 'bg-red-500'}`} />
            <span className="text-sm font-semibold text-brand">Available Bridge Liquidity</span>
          </div>
          <div className="text-4xl font-bold text-foreground">
            {tab === 'deposit' ? LIQUIDITY_DEPOSIT : LIQUIDITY_WITHDRAW}{' '}
            <span className="text-2xl text-brand">ETH</span>
          </div>
          <div className="text-sm text-muted-foreground">on Robinhood Chain</div>
          <div className="flex justify-between pt-4 mt-4 border-t border-white/5">
            <div>
              <div className="text-sm text-muted-foreground">Max per bridge</div>
              <div className="text-sm font-semibold text-foreground mt-0.5">{tab === 'deposit' ? MAX_PER_TX_DEPOSIT : MAX_PER_TX_WITHDRAW} ETH</div>
            </div>
            <div className="text-right">
              <div className="text-sm text-muted-foreground">Status</div>
              <div className={`text-sm font-semibold mt-0.5 ${STATUS === 'Online' ? 'text-green-400' : 'text-red-400'}`}>{STATUS}</div>
            </div>
          </div>
        </div>

        {/* How it works */}
        <div className="mt-3 rounded-2xl bg-surface-2 ring-1 ring-white/10 p-4">
          <div className="font-bold text-[15px] mb-3 text-foreground">How it works</div>
          {[
            'Enter the amount of ETH to bridge.',
            'A liquidity solver delivers ETH on the other side.',
            'Funds arrive in seconds — no 7-day wait.',
          ].map((text, i) => (
            <div key={i} className={`flex gap-3 items-start ${i < 2 ? 'mb-3' : ''}`}>
              <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-brand shrink-0">{i + 1}</div>
              <div className="text-sm text-muted-foreground leading-relaxed pt-0.5">{text}</div>
            </div>
          ))}
        </div>

      </main>
    </div>
  )
}
