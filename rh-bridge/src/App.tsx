import { useState, useEffect } from 'react'
import {
  useAccount, useBalance, useSendTransaction,
  useWaitForTransactionReceipt, useSwitchChain, useChainId,
} from 'wagmi'
import { useAppKit } from '@reown/appkit/react'
import { parseEther, formatEther } from 'viem'
import {} from './wagmiConfig'

const BASE_CHAIN_ID  = 8453
const RH_CHAIN_ID    = 4663
const BRIDGE_ADDRESS = '0x5dddea56774f01fc9d207bbd7b7633596a2f4a0b' as `0x${string}`

const C = {
  bg:       '#0d0101',
  surface:  '#1f0704',
  surface2: '#2a0b05',
  brand:    '#f7c243',
  brandFg:  '#1a0000',
  fg:       '#f8eac6',
  muted:    '#331511',
  mutedFg:  '#a08070',
}

function EthLogo({ size = 24 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} style={{ borderRadius: '50%', flexShrink: 0 }} fill="none">
      <circle cx="16" cy="16" r="16" fill="#627EEA"/>
      <path d="M16.5 4v8.87l7.5 3.35-7.5-12.22z" fill="white" fillOpacity=".6"/>
      <path d="M16.5 4L9 16.22l7.5-3.35V4z" fill="white"/>
      <path d="M16.5 21.97v5.68l7.52-10.4-7.52 4.72z" fill="white" fillOpacity=".6"/>
      <path d="M16.5 27.65v-5.68L9 17.25l7.5 10.4z" fill="white"/>
      <path d="M16.5 20.07l7.5-4.22-7.5 3.24-7.5-3.24 7.5 4.22z" fill="white" fillOpacity=".2"/>
    </svg>
  )
}


export default function App() {
  const [tab, setTab]           = useState<'deposit'|'withdraw'>('deposit')
  const [amount, setAmount]     = useState('')
  const [step, setStep]         = useState<'idle'|'bridging'|'done'>('idle')
  const [chainOpen, setChainOpen] = useState(false)

  const { address, isConnected } = useAccount()
  const { open }   = useAppKit()
  const chainId    = useChainId()
  const { switchChain, isPending: switching } = useSwitchChain()

  const srcChainId = tab === 'deposit' ? BASE_CHAIN_ID : RH_CHAIN_ID
  const onSrcChain = chainId === srcChainId

  const { data: balData, refetch: refetchBal } = useBalance({
    address, chainId: srcChainId, query: { enabled: !!address },
  })
  const { data: dstBalData } = useBalance({
    address, chainId: tab === 'deposit' ? RH_CHAIN_ID : BASE_CHAIN_ID, query: { enabled: !!address },
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
    if (!onSrcChain)         return switching ? 'Switching…' : `Switch to ${tab === 'deposit' ? 'Base' : 'Robinhood Chain'}`
    if (step === 'done')     return 'Bridge again'
    if (step === 'bridging') return 'Confirm in wallet…'
    if (!parsed)             return 'Enter an amount'
    if (tooMuch)             return 'Insufficient balance'
    return tab === 'deposit'
      ? `Deposit ${parsed.toLocaleString('en', { maximumFractionDigits: 6 })} ETH`
      : `Withdraw ${parsed.toLocaleString('en', { maximumFractionDigits: 6 })} ETH`
  }

  const ctaEnabled = step !== 'bridging' && (!isConnected || !onSrcChain || step === 'done' || canBridge)
  const fmtBal = (b: number | null) => b != null ? b.toLocaleString('en', { maximumFractionDigits: 4 }) : '0'

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.fg, fontFamily: 'Inter, system-ui, sans-serif', position: 'relative', overflow: 'hidden' }}>

      {/* Background glow — very subtle, no grid */}
      <div style={{ position: 'absolute', top: '-10%', left: '50%', transform: 'translateX(-50%)', width: '60rem', height: '30rem', borderRadius: '50%', background: 'rgba(247,194,67,0.06)', filter: 'blur(120px)', pointerEvents: 'none', zIndex: 0 }} />

      {/* Header */}
      <header style={{ maxWidth: 1152, margin: '0 auto', padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', position: 'relative', zIndex: 10 }}>
        <button
          onClick={() => open()}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, borderRadius: 999, background: C.brand, color: C.brandFg, padding: '8px 16px', fontSize: 14, fontWeight: 600, border: 'none', transition: 'opacity .15s' }}
          onMouseOver={e => (e.currentTarget.style.opacity = '0.9')}
          onMouseOut={e => (e.currentTarget.style.opacity = '1')}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/>
            <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>
          </svg>
          {isConnected && address ? `${address.slice(0,6)}…${address.slice(-4)}` : 'Connect'}
        </button>
      </header>

      {/* Main */}
      <main style={{ maxWidth: 448, margin: '0 auto', padding: '8px 16px 64px', position: 'relative', zIndex: 10 }}>

        {/* Logo */}
        <img
          src="/esafr-logo.png"
          alt="Bridge Logo"
          draggable={false}
          style={{ display: 'block', margin: '0 auto 16px', width: '100%', maxWidth: 384, userSelect: 'none', filter: 'drop-shadow(0 10px 40px rgba(0,0,0,0.6))' }}
        />

        {/* Bridge card */}
        <div style={{ borderRadius: 24, background: C.surface2, boxShadow: '0 30px 80px -20px rgba(0,0,0,0.6)', outline: '1px solid rgba(255,255,255,0.08)', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Card title */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px 0' }}>
            <h1 style={{ fontSize: 15, fontWeight: 600, color: C.fg }}>Bridge</h1>
            <button style={{ background: 'none', border: 'none', padding: 6, borderRadius: 6, color: C.mutedFg }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 17H5"/><path d="M19 7h-9"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>
              </svg>
            </button>
          </div>

          {/* YOU PAY */}
          <div style={{ borderRadius: 16, background: C.surface, outline: '1px solid rgba(255,255,255,0.05)', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase' as const, color: C.mutedFg }}>You pay</span>
              <button
                style={{ fontSize: 12, color: C.mutedFg, background: 'none', border: 'none' }}
                onClick={() => balance && setAmount(balance.toFixed(6))}
              >
                Balance: <span style={{ fontFamily: 'monospace', color: C.fg }}>{fmtBal(balance)}</span>
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 12 }}>
              <input
                type="number"
                inputMode="decimal"
                placeholder="0.0"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                style={{ background: 'none', border: 'none', fontSize: 30, fontWeight: 600, color: C.fg, width: '100%', fontFamily: 'Inter, system-ui, sans-serif' }}
              />
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <button
                  onClick={() => setChainOpen(o => !o)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, borderRadius: 999, background: 'rgba(255,255,255,0.05)', outline: '1px solid rgba(255,255,255,0.1)', padding: '7px 10px 7px 8px', border: 'none', maxWidth: 150, overflow: 'hidden', cursor: 'pointer' }}
                >
                  <EthLogo size={24}/>
                  <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1, textAlign: 'left', overflow: 'hidden' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: C.fg, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tab === 'deposit' ? 'Base' : 'Robinhood'}</span>
                    <span style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: C.mutedFg, marginTop: 2 }}>ETH</span>
                  </div>
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: C.mutedFg, flexShrink: 0, transform: chainOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>
                    <path d="m6 9 6 6 6-6"/>
                  </svg>
                </button>

                {chainOpen && (
                  <>
                    <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setChainOpen(false)} />
                    <div style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 50, background: C.surface2, borderRadius: 16, outline: '1px solid rgba(255,255,255,0.1)', overflow: 'hidden', minWidth: 200, boxShadow: '0 16px 40px rgba(0,0,0,0.5)' }}>
                      {[
                        { label: 'Base', sub: 'ETH', tab: 'deposit' as const },
                        { label: 'Robinhood', sub: 'ETH', tab: 'withdraw' as const },
                      ].map(opt => {
                        const active = tab === opt.tab
                        return (
                          <button
                            key={opt.tab}
                            onClick={() => { setTab(opt.tab); setChainOpen(false) }}
                            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: active ? 'rgba(255,255,255,0.07)' : 'none', border: 'none', cursor: 'pointer', textAlign: 'left' as const }}
                            onMouseOver={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
                            onMouseOut={e => { if (!active) e.currentTarget.style.background = 'none' }}
                          >
                            <EthLogo size={28}/>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 14, fontWeight: 600, color: C.fg }}>{opt.label}</div>
                              <div style={{ fontSize: 11, color: C.mutedFg, marginTop: 2 }}>{opt.sub}</div>
                            </div>
                            {active && (
                              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: C.brand }}>
                                <path d="M20 6 9 17l-5-5"/>
                              </svg>
                            )}
                          </button>
                        )
                      })}
                      <div style={{ borderTop: `1px solid ${C.muted}`, padding: '4px 0' }}>
                        <button
                          onClick={async () => {
                            setChainOpen(false)
                            try {
                              await (window as any).ethereum.request({
                                method: 'wallet_addEthereumChain',
                                params: [{
                                  chainId: '0x1237',
                                  chainName: 'Robinhood L2',
                                  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
                                  rpcUrls: ['https://poptye-always-win.poptyedev.com/'],
                                  blockExplorerUrls: ['https://so-explorer.poptyedev.com'],
                                }],
                              })
                            } catch {}
                          }}
                          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' as const }}
                          onMouseOver={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
                          onMouseOut={e => (e.currentTarget.style.background = 'none')}
                        >
                          <div style={{ width: 28, height: 28, borderRadius: '50%', background: C.muted, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: C.brand }}>
                              <path d="M5 12h14"/><path d="M12 5v14"/>
                            </svg>
                          </div>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: C.brand }}>Add Robinhood Chain</div>
                            <div style={{ fontSize: 11, color: C.mutedFg, marginTop: 2 }}>Chain ID: 4663</div>
                          </div>
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Arrow between fields */}
          <div style={{ position: 'relative', height: 0, display: 'flex', justifyContent: 'center' }}>
            <button
              onClick={() => setTab(t => t === 'deposit' ? 'withdraw' : 'deposit')}
              style={{ position: 'absolute', top: -20, left: '50%', transform: 'translateX(-50%)', width: 40, height: 40, borderRadius: 12, background: C.surface2, outline: `4px solid ${C.bg}`, border: 'none', display: 'grid', placeItems: 'center', color: C.mutedFg, zIndex: 1 }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>
              </svg>
            </button>
          </div>

          {/* YOU RECEIVE */}
          <div style={{ borderRadius: 16, background: C.surface, outline: '1px solid rgba(255,255,255,0.05)', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase' as const, color: C.mutedFg }}>You receive</span>
              <span style={{ fontSize: 12, color: C.mutedFg }}>
                Balance: <span style={{ fontFamily: 'monospace', color: C.fg }}>{fmtBal(dstBalance)}</span>
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, fontSize: 30, fontWeight: 600, color: parsed > 0 ? C.fg : 'rgba(255,255,255,0.2)', fontFamily: 'Inter, system-ui, sans-serif' }}>
                {parsed > 0 ? parsed.toLocaleString('en', { maximumFractionDigits: 6 }) : '0.0'}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderRadius: 999, background: 'rgba(255,255,255,0.05)', outline: '1px solid rgba(255,255,255,0.1)', padding: '7px 14px 7px 8px', flexShrink: 0 }}>
                <EthLogo size={24}/>
                <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1, textAlign: 'left' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.fg }}>{tab === 'deposit' ? 'Robinhood' : 'Base'}</span>
                  <span style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: C.mutedFg, marginTop: 2 }}>ETH</span>
                </div>
              </div>
            </div>
          </div>

          {/* CTA button */}
          <button
            onClick={handleCta}
            disabled={!ctaEnabled}
            style={{ width: '100%', height: 56, borderRadius: 16, border: 'none', fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 600, fontSize: 16, background: ctaEnabled ? C.brand : 'rgba(247,194,67,0.4)', color: C.brandFg, opacity: ctaEnabled ? 1 : 0.6, cursor: ctaEnabled ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'opacity .15s' }}
          >
            {step === 'bridging' && (
              <span style={{ width: 16, height: 16, border: `2px solid ${C.brandFg}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />
            )}
            {ctaLabel()}
          </button>
        </div>

        {/* Footer */}
        <div style={{ marginTop: 16, textAlign: 'center', fontSize: 11, color: C.mutedFg }}>
          RobinBridge · powered by <span style={{ color: C.fg }}>Relay</span>
        </div>


      </main>
    </div>
  )
}
