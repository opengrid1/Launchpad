import { useState, useEffect } from 'react'
import {
  useAccount, useBalance, useSendTransaction,
  useWaitForTransactionReceipt, useSwitchChain, useChainId,
} from 'wagmi'
import { useAppKit } from '@reown/appkit/react'
import { parseEther, formatEther } from 'viem'
import { mainnet } from './wagmiConfig'

const RH_CHAIN_ID = 4663
const BRIDGE_ADDRESS = '0x5dddea56774f01fc9d207bbd7b7633596a2f4a0b' as `0x${string}`
const LIQUIDITY_DEPOSIT  = 34.7502
const LIQUIDITY_WITHDRAW = 34.7502
const MAX_PER_TX_DEPOSIT  = 27.8002
const MAX_PER_TX_WITHDRAW = 27.8002
const STATUS: string = 'Online'
const ACCENT = '#f0a030'
const BG     = '#0f0203'
const CARD   = '#1c0607'
const BORDER = '#3d1212'

const CSS = `
  @keyframes spin { to { transform: rotate(360deg) } }
  * { box-sizing: border-box; margin: 0; padding: 0 }
  html, body { height: 100%; background: ${BG}; }
  input[type=number]::-webkit-outer-spin-button,
  input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none }
  input[type=number] { -moz-appearance: textfield }
  input:focus { outline: none }
  .add-chain:hover { opacity: .8 }
`

function EthLogo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" style={{ borderRadius: '50%', background: '#627EEA', flexShrink: 0 }}>
      <path d="M16 5l-6.5 11.2L16 19.6l6.5-3.4z" fill="white" fillOpacity=".9"/>
      <path d="M16 19.6l-6.5-3.4L16 27l6.5-7.8z" fill="white" fillOpacity=".6"/>
    </svg>
  )
}

function RHLogo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" style={{ borderRadius: '50%', background: '#1a0607', border: '1.5px solid #5a2020', flexShrink: 0 }}>
      <text x="50%" y="55%" dominantBaseline="middle" textAnchor="middle" fontSize="16" fill={ACCENT} fontWeight="bold">R</text>
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

  const balance    = balData ? +formatEther(balData.value) : null
  const dstBalance = dstBalData ? +formatEther(dstBalData.value) : null
  const parsed     = parseFloat(amount) || 0
  const receive    = parsed
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
    doBridge({
      to: BRIDGE_ADDRESS,
      value: parseEther(parsed.toFixed(18)),
      chainId: srcChainId,
    })
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

  const ctaEnabled = step === 'bridging' ? false
    : !isConnected ? true
    : !onSrcChain ? true
    : step === 'done' ? true
    : canBridge

  const fmtBal = (b: number | null) =>
    b != null ? b.toLocaleString('en', { maximumFractionDigits: 4 }) : '0'

  const srcLabel  = tab === 'deposit' ? 'Ethereum' : 'Robinhood'
  const dstLabel  = tab === 'deposit' ? 'Robinhood' : 'Ethereum'

  return (
    <>
      <style>{CSS}</style>
      <div style={{ minHeight: '100vh', background: BG, fontFamily: 'Inter, sans-serif', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 0 60px' }}>

        {/* Header */}
        <div style={{ position: 'sticky', top: 0, zIndex: 100, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', background: BG }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src="/rh-logo.png" alt="RobinBridge" style={{ width: 32, height: 32, borderRadius: 7 }} />
            <span style={{ fontWeight: 700, fontSize: 16, letterSpacing: '-0.3px' }}>
              <span style={{ color: '#fff' }}>Robin</span><span style={{ color: ACCENT }}>Bridge</span>
            </span>
          </div>
          <button
            onClick={() => open()}
            style={{ background: isConnected ? '#2a0a0a' : ACCENT, border: isConnected ? `1px solid ${BORDER}` : 'none', borderRadius: 999, padding: '10px 18px', cursor: 'pointer', fontFamily: 'Inter, sans-serif', fontWeight: 700, fontSize: 14, color: isConnected ? '#ccc' : '#1a0000', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            {!isConnected && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 12h.01"/>
                <path d="M6 7V5a2 2 0 012-2h8a2 2 0 012 2v2"/>
              </svg>
            )}
            {isConnected && address ? `${address.slice(0,6)}…${address.slice(-4)}` : 'Connect'}
          </button>
        </div>

        <div style={{ width: '100%', maxWidth: 420, padding: '0 16px' }}>

          {/* Hero banner */}
          <div style={{ borderRadius: 16, overflow: 'hidden', marginBottom: 20 }}>
            <img src="/rh-hero.png" alt="Robinbridge" style={{ width: '100%', display: 'block' }} />
          </div>

          {/* Tagline */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, paddingLeft: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: ACCENT, flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: '#888' }}>Powered by Relay · settles in seconds · no allowlist</span>
          </div>

          {/* Bridge card */}
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 20, padding: 16, marginBottom: 12 }}>

            {/* Card header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 0, background: '#120304', borderRadius: 10, padding: 3 }}>
                <button onClick={() => setTab('deposit')}  style={{ padding: '7px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 13, background: tab === 'deposit' ? ACCENT : 'transparent', color: tab === 'deposit' ? '#1a0000' : '#777', transition: 'all .15s' }}>Deposit → RH</button>
                <button onClick={() => setTab('withdraw')} style={{ padding: '7px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 13, background: tab === 'withdraw' ? ACCENT : 'transparent', color: tab === 'withdraw' ? '#1a0000' : '#777', transition: 'all .15s' }}>Withdraw → ETH</button>
              </div>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="2" style={{ cursor: 'pointer' }}>
                <line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/>
                <circle cx="9" cy="6" r="2" fill="#120304" stroke="#555"/>
                <circle cx="15" cy="12" r="2" fill="#120304" stroke="#555"/>
                <circle cx="9" cy="18" r="2" fill="#120304" stroke="#555"/>
              </svg>
            </div>

            {/* YOU PAY */}
            <div style={{ background: '#120304', border: `1px solid ${BORDER}`, borderRadius: 14, padding: '12px 14px', marginBottom: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: '#666', textTransform: 'uppercase' }}>You Pay</span>
                <span style={{ fontSize: 12, color: '#666' }}>
                  Balance: <span style={{ color: '#aaa', cursor: 'pointer' }} onClick={() => balance && setAmount(balance.toFixed(6))}>{fmtBal(balance)}</span>
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <input
                  type="number"
                  placeholder="0.01"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  style={{ background: 'none', border: 'none', fontSize: 28, fontWeight: 700, color: '#fff', width: '100%', fontFamily: 'Inter, sans-serif' }}
                />
                <div style={{ background: '#1e0608', border: `1px solid ${BORDER}`, borderRadius: 10, padding: '7px 12px', display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0, cursor: 'pointer' }}>
                  {tab === 'deposit' ? <EthLogo size={18}/> : <RHLogo size={18}/>}
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', lineHeight: 1 }}>{srcLabel}</div>
                    <div style={{ fontSize: 10, color: '#666', lineHeight: 1, marginTop: 2 }}>ETH</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Arrow */}
            <div style={{ display: 'flex', justifyContent: 'center', margin: '2px 0' }}>
              <div style={{ background: '#1e0608', border: `2px solid #120304`, borderRadius: 10, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M7 2v10M3 8l4 4 4-4" stroke={ACCENT} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            </div>

            {/* YOU RECEIVE */}
            <div style={{ background: '#120304', border: `1px solid ${BORDER}`, borderRadius: 14, padding: '12px 14px', marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: '#666', textTransform: 'uppercase' }}>You Receive</span>
                <span style={{ fontSize: 12, color: '#666' }}>Balance: <span style={{ color: '#aaa' }}>{fmtBal(dstBalance)}</span></span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: receive > 0 ? '#fff' : '#444' }}>
                  {receive > 0 ? receive.toLocaleString('en', { maximumFractionDigits: 6 }) : '0.0'}
                </div>
                <div style={{ background: '#1e0608', border: `1px solid ${BORDER}`, borderRadius: 10, padding: '7px 12px', display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
                  {tab === 'deposit' ? <RHLogo size={18}/> : <EthLogo size={18}/>}
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', lineHeight: 1 }}>{dstLabel}</div>
                    <div style={{ fontSize: 10, color: '#666', lineHeight: 1, marginTop: 2 }}>ETH</div>
                  </div>
                </div>
              </div>
            </div>

            {/* CTA */}
            <button
              onClick={handleCta}
              disabled={!ctaEnabled}
              style={{ width: '100%', padding: '16px 0', borderRadius: 14, border: 'none', cursor: ctaEnabled ? 'pointer' : 'not-allowed', fontFamily: 'Inter, sans-serif', fontWeight: 700, fontSize: 16, background: ctaEnabled ? ACCENT : '#2a0a0a', color: ctaEnabled ? '#1a0000' : '#555', transition: 'all .15s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            >
              {step === 'bridging' && (
                <span style={{ width: 16, height: 16, border: `2px solid #1a0000`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite', display: 'inline-block' }}/>
              )}
              {ctaLabel()}
            </button>
          </div>

          {/* Liquidity card */}
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 20, padding: 16, marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS === 'Online' ? '#4ade80' : '#ef4444', flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: ACCENT }}>Available Bridge Liquidity</span>
            </div>
            <div style={{ fontSize: 40, fontWeight: 700, color: '#fff' }}>
              {tab === 'deposit' ? LIQUIDITY_DEPOSIT : LIQUIDITY_WITHDRAW}{' '}
              <span style={{ fontSize: 24, color: ACCENT }}>ETH</span>
            </div>
            <div style={{ fontSize: 13, color: '#666', marginTop: 2 }}>on Robinhood Chain</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16, paddingTop: 16, borderTop: `1px solid ${BORDER}` }}>
              <div>
                <div style={{ fontSize: 13, color: '#777' }}>Max per bridge</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginTop: 2 }}>{tab === 'deposit' ? MAX_PER_TX_DEPOSIT : MAX_PER_TX_WITHDRAW} ETH</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, color: '#777' }}>Status</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: STATUS === 'Online' ? '#4ade80' : '#ef4444', marginTop: 2 }}>{STATUS}</div>
              </div>
            </div>
          </div>

          {/* How it works */}
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 20, padding: 16, marginBottom: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>How it works</div>
            {[
              'Enter the amount of ETH to bridge.',
              'A liquidity solver delivers ETH on the other side.',
              'Funds arrive in seconds — no 7-day wait.',
            ].map((text, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: i < 2 ? 12 : 0 }}>
                <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#120304', border: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: ACCENT, flexShrink: 0 }}>{i + 1}</div>
                <div style={{ fontSize: 13, color: '#999', lineHeight: 1.5, paddingTop: 3 }}>{text}</div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 4 }}>
            <span className="add-chain" style={{ fontSize: 13, color: ACCENT, cursor: 'pointer' }} onClick={() => switchChain({ chainId: RH_CHAIN_ID })}>
              + Add Robinhood Chain
            </span>
            <span style={{ fontSize: 12, color: '#444' }}>RobinBridge · powered by Relay</span>
          </div>

        </div>
      </div>
    </>
  )
}
