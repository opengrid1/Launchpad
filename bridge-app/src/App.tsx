import { useState, useEffect } from 'react'
import {
  useAccount, useReadContract, useWriteContract,
  useWaitForTransactionReceipt, useSwitchChain,
  useChainId, useConnect, useDisconnect,
} from 'wagmi'
import { injected } from 'wagmi/connectors'
import { formatUnits, parseUnits, pad } from 'viem'
import { mainnet, USDC_ADDRESS } from './wagmiConfig'

const TOKEN_MESSENGER = '0xBd3fa81B58Ba92a82136038B25aDec7066af3155' as `0x${string}`
const ARC_DOMAIN = 7

const ERC20_ABI = [
  { name: 'balanceOf',  type: 'function', stateMutability: 'view',  inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'allowance', type: 'function', stateMutability: 'view',        inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'approve',   type: 'function', stateMutability: 'nonpayable',  inputs: [{ name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }],  outputs: [{ name: '', type: 'bool' }] },
] as const

const MESSENGER_ABI = [{
  name: 'depositForBurn', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'amount',            type: 'uint256' },
    { name: 'destinationDomain', type: 'uint32'  },
    { name: 'mintRecipient',     type: 'bytes32' },
    { name: 'burnToken',         type: 'address' },
  ],
  outputs: [{ name: 'nonce', type: 'uint64' }],
}] as const

const CSS = `
  @keyframes spin  { to { transform: rotate(360deg) } }
  @keyframes pulse { 0%,100%{opacity:.35} 50%{opacity:.9} }
  @keyframes up    { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }
  * { box-sizing: border-box; margin: 0; padding: 0 }
  input[type=number]::-webkit-outer-spin-button,
  input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none }
  input[type=number] { -moz-appearance: textfield }
  input:focus { outline: none }
  html, body { height: 100% }
`

function EthLogo({ s = 32 }: { s?: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 32 32" style={{ borderRadius: '50%', background: '#627EEA', flexShrink: 0, display: 'block' }}>
      <path d="M16 5l-6.5 11.2L16 19.6l6.5-3.4z" fill="white" fillOpacity=".9"/>
      <path d="M16 19.6l-6.5-3.4L16 27l6.5-7.8z" fill="white" fillOpacity=".6"/>
    </svg>
  )
}

export default function App() {
  const [amount, setAmount] = useState('')
  const [focused, setFocused] = useState(false)
  const [step, setStep] = useState<'idle'|'approving'|'bridging'|'done'>('idle')

  const { address, isConnected } = useAccount()
  const { connect }    = useConnect()
  const { disconnect } = useDisconnect()
  const chainId        = useChainId()
  const { switchChain, isPending: switching } = useSwitchChain()

  const { data: balRaw, refetch: refetchBal } = useReadContract({
    address: USDC_ADDRESS, abi: ERC20_ABI, functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: mainnet.id, query: { enabled: !!address },
  })
  const { data: allowRaw, refetch: refetchAllow } = useReadContract({
    address: USDC_ADDRESS, abi: ERC20_ABI, functionName: 'allowance',
    args: address ? [address, TOKEN_MESSENGER] : undefined,
    chainId: mainnet.id, query: { enabled: !!address },
  })

  const balance   = balRaw   != null ? +formatUnits(balRaw   as bigint, 6) : null
  const allowance = allowRaw != null ? +formatUnits(allowRaw as bigint, 6) : 0
  const parsed    = parseFloat(amount) || 0
  const onMainnet = chainId === mainnet.id
  const tooMuch   = balance != null && parsed > balance
  const needsApproval = parsed > 0 && parsed > allowance
  const canSubmit = isConnected && onMainnet && parsed > 0 && !tooMuch && step === 'idle'
  const inFlight  = step === 'approving' || step === 'bridging'

  const { writeContract: doApprove, data: approveTx } = useWriteContract()
  const { isSuccess: approveOk } = useWaitForTransactionReceipt({ hash: approveTx, chainId: mainnet.id })

  const { writeContract: doBridge, data: bridgeTx } = useWriteContract()
  const { isSuccess: bridgeOk }   = useWaitForTransactionReceipt({ hash: bridgeTx,  chainId: mainnet.id })

  useEffect(() => {
    if (!approveOk || step !== 'approving' || !address) return
    refetchAllow()
    setStep('bridging')
    doBridge({ address: TOKEN_MESSENGER, abi: MESSENGER_ABI, functionName: 'depositForBurn',
      args: [parseUnits(amount, 6), ARC_DOMAIN, pad(address, { size: 32 }), USDC_ADDRESS],
      chainId: mainnet.id })
  }, [approveOk])

  useEffect(() => {
    if (!bridgeOk || step !== 'bridging') return
    refetchBal(); setStep('done')
  }, [bridgeOk])

  function submit() {
    if (!canSubmit || !address) return
    const amt = parseUnits(amount, 6)
    if (needsApproval) {
      setStep('approving')
      doApprove({ address: USDC_ADDRESS, abi: ERC20_ABI, functionName: 'approve', args: [TOKEN_MESSENGER, amt], chainId: mainnet.id })
    } else {
      setStep('bridging')
      doBridge({ address: TOKEN_MESSENGER, abi: MESSENGER_ABI, functionName: 'depositForBurn',
        args: [amt, ARC_DOMAIN, pad(address, { size: 32 }), USDC_ADDRESS], chainId: mainnet.id })
    }
  }

  function handleCta() {
    if (!isConnected)        return connect({ connector: injected() })
    if (!onMainnet)          return switchChain({ chainId: mainnet.id })
    if (step === 'done')     return () => { setStep('idle'); setAmount('') }
    submit()
  }

  const ctaLabel = (): string => {
    if (!isConnected)               return 'Connect wallet'
    if (!onMainnet)                 return switching ? 'Switching…' : 'Switch to Ethereum'
    if (step === 'done')            return 'Bridge again'
    if (step === 'approving')       return 'Confirm approval in wallet'
    if (step === 'bridging')        return 'Confirm transaction in wallet'
    if (!parsed)                    return 'Enter an amount'
    if (tooMuch)                    return 'Insufficient balance'
    if (needsApproval)              return `Approve & Bridge ${parsed.toLocaleString('en', { maximumFractionDigits: 2 })} USDC`
    return `Bridge ${parsed.toLocaleString('en', { maximumFractionDigits: 2 })} USDC`
  }

  const ctaEnabled = (): boolean => {
    if (step === 'done')  return true
    if (inFlight)         return false
    if (!isConnected)     return true
    if (!onMainnet)       return true
    return canSubmit
  }

  const balFmt = balance != null
    ? balance.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : null

  return (
    <>
      <style>{CSS}</style>
      <div style={{
        minHeight: '100vh',
        background: '#060914',
        backgroundImage: `
          radial-gradient(ellipse 80% 50% at 50% -10%, rgba(41,55,143,0.45) 0%, transparent 70%),
          radial-gradient(ellipse 50% 30% at 80% 80%, rgba(20,35,90,0.3) 0%, transparent 60%)
        `,
        color: '#e8eaf0',
        fontFamily: "'Inter', system-ui, sans-serif",
        WebkitFontSmoothing: 'antialiased',
      }}>

        {/* Nav */}
        <nav style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 20px', height: 56,
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          backdropFilter: 'blur(12px)',
          background: 'rgba(6,9,20,0.7)',
          position: 'sticky', top: 0, zIndex: 100,
        }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.4px' }}>
              <span style={{ color: '#e8eaf0' }}>Arcane</span><span style={{ color: '#7b8fff' }}>bridge</span>
            </span>
          </div>
          <button
            onClick={isConnected ? () => disconnect() : () => connect({ connector: injected() })}
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '7px 14px', borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.1)',
              background: isConnected ? 'rgba(255,255,255,0.04)' : '#7b8fff',
              color: isConnected ? '#9da3b4' : '#0c0f1a',
              fontSize: 13, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {isConnected && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ade80', display: 'block', flexShrink: 0 }} />}
            <span style={{ fontFamily: isConnected ? "'JetBrains Mono', monospace" : 'inherit', fontSize: isConnected ? 11 : 13 }}>
              {isConnected ? `${address?.slice(0,6)}…${address?.slice(-4)}` : 'Connect wallet'}
            </span>
          </button>
        </nav>

        {/* Page */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 16px 80px' }}>
          <div style={{ width: '100%', maxWidth: 460 }}>

            {/* Header */}
            <div style={{ textAlign: 'center', marginBottom: 28 }}>
              <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.8px', color: '#e8eaf0', lineHeight: 1.15 }}>
                Bridge USDC
              </h1>
              <p style={{ marginTop: 6, fontSize: 13, color: '#525870', letterSpacing: '-0.1px' }}>
                Ethereum → Arc Network via Circle CCTP
              </p>
            </div>

            {/* Card */}
            <div style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 16,
              overflow: 'hidden',
            }}>

              {/* FROM */}
              <div style={{
                padding: '18px 20px 16px',
                borderBottom: `1px solid ${focused ? 'rgba(123,143,255,0.25)' : 'rgba(255,255,255,0.06)'}`,
                transition: 'border-color 0.15s',
                cursor: 'text',
              }} onClick={() => document.getElementById('amount-input')?.focus()}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <EthLogo s={32} />
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#e8eaf0', letterSpacing: '-0.2px' }}>Ethereum</div>
                      <div style={{ fontSize: 11, color: '#42475e', marginTop: 2, fontFamily: "'JetBrains Mono', monospace" }}>Mainnet</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#42475e', textTransform: 'uppercase' }}>From</div>
                </div>

                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <input
                    id="amount-input"
                    type="number"
                    placeholder="0.00"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    style={{
                      flex: 1, background: 'transparent', border: 'none', outline: 'none',
                      fontSize: 38, fontWeight: 700, letterSpacing: '-1.5px',
                      color: tooMuch ? '#f87171' : '#e8eaf0',
                      fontFamily: 'inherit', minWidth: 0, lineHeight: 1,
                    }}
                  />
                  <span style={{ fontSize: 15, fontWeight: 600, color: '#42475e', paddingBottom: 3, flexShrink: 0 }}>USDC</span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8, gap: 8, alignItems: 'center' }}>
                  {balFmt && (
                    <>
                      <span style={{ fontSize: 12, color: tooMuch ? '#f87171' : '#525870' }}>
                        Balance: <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>{balFmt}</span>
                      </span>
                      <button
                        onClick={() => balance && setAmount(balance.toFixed(2))}
                        style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: '#7b8fff', background: 'rgba(123,143,255,0.1)', border: '1px solid rgba(123,143,255,0.2)', borderRadius: 4, padding: '2px 7px', cursor: 'pointer', fontFamily: 'inherit', textTransform: 'uppercase' }}
                      >
                        Max
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Arrow divider */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 32, background: 'rgba(0,0,0,0.15)', position: 'relative' }}>
                <div style={{ position: 'absolute', left: 0, right: 0, height: '50%', borderBottom: '1px solid rgba(255,255,255,0.04)' }} />
                <div style={{
                  position: 'relative', zIndex: 1, width: 26, height: 26, borderRadius: '50%',
                  background: '#0c1020', border: '1px solid rgba(255,255,255,0.1)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M5 1.5v7M2 6l3 3.5 3-3.5" stroke="#42475e" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
              </div>

              {/* TO */}
              <div style={{ padding: '16px 20px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <img src="/logo-1.png" width={32} height={32} style={{ borderRadius: 9, objectFit: 'cover', flexShrink: 0 }} alt="Arc Network" />
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#e8eaf0', letterSpacing: '-0.2px' }}>Arc Network</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#42475e', textTransform: 'uppercase' }}>To</div>
                </div>

                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: 38, fontWeight: 700, letterSpacing: '-1.5px', color: parsed > 0 ? '#e8eaf0' : '#2a2e42', lineHeight: 1 }}>
                    {parsed > 0 ? parsed.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}
                  </div>
                  <span style={{ fontSize: 15, fontWeight: 600, color: '#42475e', paddingBottom: 3 }}>USDC</span>
                </div>
              </div>

              {/* Details strip */}
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', background: 'rgba(0,0,0,0.2)', padding: '0 20px' }}>
                {[
                  ['Network fee',       '0.00 USDC',           '#e8eaf0'],
                  ['Mint capacity',     '10,000.000001 USDC',  '#e8eaf0'],
                  ['Est. time',         '~15 min',             '#e8eaf0'],
                  ['Router',            'Circle CCTP',         '#e8eaf0'],
                ].map(([k, v, c], i, a) => (
                  <div key={k} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '10px 0',
                    borderBottom: i < a.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                  }}>
                    <span style={{ fontSize: 12, color: '#42475e' }}>{k}</span>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: c as string }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Progress */}
            {step !== 'idle' && (
              <div style={{
                marginTop: 10, padding: '16px 20px',
                background: 'rgba(255,255,255,0.025)',
                border: '1px solid rgba(255,255,255,0.07)',
                borderRadius: 14, animation: 'up 0.2s ease',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: step === 'done' ? '#4ade80' : '#e8eaf0' }}>
                    {step === 'done' ? '✓ Submitted to CCTP' : 'Bridging in progress'}
                  </span>
                  {step === 'done' && (
                    <button onClick={() => { setStep('idle'); setAmount('') }} style={{ fontSize: 11, color: '#525870', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                      New transfer
                    </button>
                  )}
                </div>
                {[
                  { label: 'Approve USDC',      done: ['bridging','done'].includes(step), active: step === 'approving' },
                  { label: 'Deposit via CCTP',  done: step === 'done',                    active: step === 'bridging' },
                  { label: 'Relay to Arc',       done: false,                              active: false, pending: step === 'done' },
                ].map((s, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: i < 2 ? 10 : 0 }}>
                    <div style={{
                      width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                      border: `1.5px solid ${s.done ? '#4ade80' : s.active ? '#7b8fff' : 'rgba(255,255,255,0.08)'}`,
                      background: s.done ? '#4ade80' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s',
                    }}>
                      {s.done   && <svg width="8" height="6" viewBox="0 0 8 6" fill="none"><path d="M1 3l2 2 4-4" stroke="#060914" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      {s.active && <div style={{ width: 5, height: 5, border: '1.5px solid #525870', borderTopColor: '#7b8fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />}
                      {s.pending && !s.done && <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', animation: 'pulse 1.5s ease infinite' }} />}
                    </div>
                    <span style={{ fontSize: 13, color: s.done ? '#42475e' : s.active ? '#e8eaf0' : '#42475e', fontWeight: s.active ? 500 : 400 }}>{s.label}</span>
                  </div>
                ))}
                {bridgeTx && (
                  <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 11, color: '#42475e', fontFamily: "'JetBrains Mono', monospace" }}>{bridgeTx.slice(0,18)}…</span>
                    <a href={`https://etherscan.io/tx/${bridgeTx}`} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#7b8fff', display: 'flex', gap: 4 }}>
                      Etherscan ↗
                    </a>
                  </div>
                )}
              </div>
            )}

            {/* CTA */}
            <button
              onClick={ctaEnabled() ? handleCta : undefined}
              style={{
                marginTop: 10, width: '100%', padding: '14px',
                borderRadius: 12, border: 'none', fontSize: 15, fontWeight: 700,
                letterSpacing: '-0.3px', cursor: ctaEnabled() ? 'pointer' : 'default',
                fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                background: ctaEnabled()
                  ? '#7b8fff'
                  : 'rgba(255,255,255,0.04)',
                color: ctaEnabled() ? '#0c0f1a' : '#42475e',
                boxShadow: 'none',
                transition: 'all 0.15s',
              }}
            >
              {inFlight && <span style={{ width: 14, height: 14, border: '2px solid rgba(0,0,0,0.2)', borderTopColor: '#0c0f1a', borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />}
              {ctaLabel()}
            </button>

            <p style={{ textAlign: 'center', fontSize: 11, color: '#2a2e42', marginTop: 14 }}>
              Non-custodial · <a href="https://www.circle.com/cctp" target="_blank" rel="noreferrer" style={{ color: '#2a2e42', textDecoration: 'underline' }}>Circle CCTP</a>
            </p>

          </div>
        </div>
      </div>
    </>
  )
}
