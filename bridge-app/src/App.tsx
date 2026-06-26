import { useState, useEffect } from 'react'
import {
  useAccount, useReadContract, useWriteContract,
  useWaitForTransactionReceipt, useSwitchChain,
  useChainId, useConnect, useDisconnect,
} from 'wagmi'
import { injected } from 'wagmi/connectors'
import { formatUnits, parseUnits, pad } from 'viem'
import { mainnet, USDC_ADDRESS } from './wagmiConfig'

/* ── CCTP contract on Ethereum mainnet ───────────────────────────── */
const TOKEN_MESSENGER = '0xBd3fa81B58Ba92a82136038B25aDec7066af3155' as `0x${string}`
// ARC Mainnet CCTP domain (contact ARC team for official value; 7 used here)
const ARC_DOMAIN = 7

const ERC20_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
] as const

const MESSENGER_ABI = [{
  name: 'depositForBurn',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'amount',            type: 'uint256' },
    { name: 'destinationDomain', type: 'uint32'  },
    { name: 'mintRecipient',     type: 'bytes32' },
    { name: 'burnToken',         type: 'address' },
  ],
  outputs: [{ name: 'nonce', type: 'uint64' }],
}] as const

const C = {
  bg:       '#09090b',
  surface:  '#0f0f12',
  surfaceHi:'#141418',
  border:   '#1c1c22',
  borderHi: '#26262e',
  text1:    '#fafafa',
  text2:    '#a1a1aa',
  text3:    '#52525b',
  green:    '#4ade80',
  red:      '#f87171',
  amber:    '#fbbf24',
} as const

const CSS = `
  @keyframes spin  { to { transform: rotate(360deg); } }
  @keyframes pulse { 0%,100% { opacity:.4 } 50% { opacity:1 } }
  @keyframes up    { from { opacity:0; transform:translateY(5px) } to { opacity:1; transform:translateY(0) } }
  * { box-sizing:border-box }
  input[type=number]::-webkit-outer-spin-button,
  input[type=number]::-webkit-inner-spin-button { -webkit-appearance:none }
  input[type=number] { -moz-appearance:textfield }
  input:focus { outline:none }
  a { color:inherit }
`

/* ── ETH logo as embedded SVG (no external fetch) ────────────────── */
function EthLogo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" style={{ borderRadius: '50%', background: '#1a1aff', flexShrink: 0 }}>
      <path d="M16 6L9.5 16.4 16 20.1 22.5 16.4z" fill="white"/>
      <path d="M16 20.1L9.5 16.4 16 26 22.5 16.4z" fill="rgba(255,255,255,0.6)"/>
      <path d="M16 6L9.5 16.4 16 13.7z" fill="rgba(255,255,255,0.7)"/>
      <path d="M16 6L22.5 16.4 16 13.7z" fill="white"/>
    </svg>
  )
}

export default function App() {
  const [amount, setAmount]   = useState('')
  const [focused, setFocused] = useState(false)
  const [step, setStep]       = useState<'idle'|'approving'|'bridging'|'done'>('idle')

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
  const { data: allowanceRaw, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS, abi: ERC20_ABI, functionName: 'allowance',
    args: address ? [address, TOKEN_MESSENGER] : undefined,
    chainId: mainnet.id, query: { enabled: !!address },
  })

  const balance   = balRaw       != null ? +formatUnits(balRaw as bigint,       6) : null
  const allowance = allowanceRaw != null ? +formatUnits(allowanceRaw as bigint,  6) : 0
  const parsed    = parseFloat(amount) || 0
  const onMainnet = chainId === mainnet.id
  const tooMuch   = balance != null && parsed > balance
  const needsApproval = parsed > 0 && parsed > allowance
  const canSubmit = isConnected && onMainnet && parsed > 0 && !tooMuch && step === 'idle'

  /* ── write: approve ── */
  const { writeContract: approve, data: approveTx } = useWriteContract()
  const { isSuccess: approveConfirmed, isLoading: approveWaiting } =
    useWaitForTransactionReceipt({ hash: approveTx, chainId: mainnet.id })

  /* ── write: depositForBurn ── */
  const { writeContract: bridge, data: bridgeTx } = useWriteContract()
  const { isSuccess: bridgeConfirmed, isLoading: bridgeWaiting } =
    useWaitForTransactionReceipt({ hash: bridgeTx, chainId: mainnet.id })

  /* ── state machine ── */
  useEffect(() => {
    if (approveConfirmed && step === 'approving') {
      refetchAllowance()
      setStep('bridging')
      if (!address) return
      bridge({
        address: TOKEN_MESSENGER,
        abi: MESSENGER_ABI,
        functionName: 'depositForBurn',
        args: [
          parseUnits(amount, 6),
          ARC_DOMAIN,
          pad(address, { size: 32 }),
          USDC_ADDRESS,
        ],
        chainId: mainnet.id,
      })
    }
  }, [approveConfirmed])

  useEffect(() => {
    if (bridgeConfirmed && step === 'bridging') {
      refetchBal()
      setStep('done')
    }
  }, [bridgeConfirmed])

  function submit() {
    if (!canSubmit || !address) return
    const amt = parseUnits(amount, 6)
    if (needsApproval) {
      setStep('approving')
      approve({ address: USDC_ADDRESS, abi: ERC20_ABI, functionName: 'approve', args: [TOKEN_MESSENGER, amt], chainId: mainnet.id })
    } else {
      setStep('bridging')
      bridge({ address: TOKEN_MESSENGER, abi: MESSENGER_ABI, functionName: 'depositForBurn', args: [amt, ARC_DOMAIN, pad(address, { size: 32 }), USDC_ADDRESS], chainId: mainnet.id })
    }
  }

  function reset() { setStep('idle'); setAmount('') }

  const balFmt = balance != null ? balance.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : null
  const inFlight = step === 'approving' || step === 'bridging'

  const ctaLabel = () => {
    if (!isConnected) return 'Connect wallet'
    if (!onMainnet)   return switching ? 'Switching…' : 'Switch to Ethereum'
    if (step === 'done') return 'Bridge again'
    if (step === 'approving') return approveWaiting ? 'Approving USDC…' : 'Confirm in wallet'
    if (step === 'bridging')  return bridgeWaiting  ? 'Sending to Arc…'  : 'Confirm in wallet'
    if (tooMuch) return 'Insufficient balance'
    if (!parsed)  return 'Enter amount'
    if (needsApproval) return `Approve & Bridge ${parsed.toLocaleString('en', { maximumFractionDigits: 2 })} USDC`
    return `Bridge ${parsed.toLocaleString('en', { maximumFractionDigits: 2 })} USDC`
  }

  const ctaActive = () => {
    if (step === 'done') return true
    if (inFlight) return false
    return canSubmit
  }

  function handleCta() {
    if (!isConnected) return connect({ connector: injected() })
    if (!onMainnet)   return switchChain({ chainId: mainnet.id })
    if (step === 'done') return reset()
    return submit()
  }

  return (
    <>
      <style>{CSS}</style>
      <div style={{ minHeight: '100vh', background: C.bg, color: C.text1, fontFamily: "'Inter', system-ui, sans-serif", WebkitFontSmoothing: 'antialiased' }}>

        {/* ── Nav ── */}
        <nav style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 28px', height: 54, borderBottom: `1px solid ${C.border}`, position: 'sticky', top: 0, background: C.bg, zIndex: 100 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 2L14 13H2L8 2Z" fill={C.text1}/>
            </svg>
            <span style={{ fontSize: 14, fontWeight: 650, letterSpacing: '-0.3px' }}>ArcBridge</span>
          </div>
          <button
            onClick={isConnected ? () => disconnect() : () => connect({ connector: injected() })}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 6, border: `1px solid ${C.border}`, background: 'transparent', color: C.text2, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '-0.1px' }}
          >
            {isConnected && <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.green, display: 'block' }} />}
            <span style={{ fontFamily: isConnected ? "'JetBrains Mono', monospace" : 'inherit', fontSize: isConnected ? 11 : 12 }}>
              {isConnected ? `${address?.slice(0,6)}…${address?.slice(-4)}` : 'Connect wallet'}
            </span>
          </button>
        </nav>

        {/* ── Layout ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 460px 1fr', gap: 40, maxWidth: 1100, margin: '0 auto', padding: '56px 24px 80px', alignItems: 'start' }}>

          {/* Left: route info */}
          <div style={{ paddingTop: 8 }}>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', color: C.text3, textTransform: 'uppercase', marginBottom: 24 }}>Route</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              <RouteStep icon={<EthLogo size={28} />} name="Ethereum" sub="Mainnet" connector />
              <RouteStep icon={<img src="/logo-1.png" width={28} height={28} style={{ borderRadius: 7, objectFit: 'cover' }} alt="" />} name="Arc Network" sub="Chain 5042" />
            </div>
            <div style={{ marginTop: 32, padding: '14px 0', borderTop: `1px solid ${C.border}` }}>
              {[
                ['Protocol',   'Circle CCTP'],
                ['Token',      'USDC (native)'],
                ['Finality',   '~15 min'],
                ['Fee',        '0.00 USDC'],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontSize: 12, color: C.text3 }}>{k}</span>
                  <span style={{ fontSize: 12, color: C.text2, fontFamily: "'JetBrains Mono', monospace" }}>{v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Center: card */}
          <div>
            {/* FROM */}
            <Section label="From" border focused={focused}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <EthLogo size={30} />
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: C.text1, letterSpacing: '-0.2px' }}>Ethereum</div>
                    <div style={{ fontSize: 11, color: C.text3, marginTop: 2, fontFamily: "'JetBrains Mono', monospace" }}>Mainnet</div>
                  </div>
                </div>
                {balFmt && (
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 11, color: C.text3, marginBottom: 3 }}>Balance</div>
                    <button
                      onClick={() => balance && setAmount(balance.toFixed(2))}
                      style={{ fontSize: 13, fontWeight: 600, color: tooMuch ? C.red : C.text2, background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'JetBrains Mono', monospace", padding: 0 }}
                    >
                      {balFmt}
                    </button>
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
                <input
                  type="number"
                  placeholder="0.00"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: 36, fontWeight: 700, letterSpacing: '-1.5px', color: tooMuch ? C.red : C.text1, fontFamily: 'inherit', minWidth: 0, lineHeight: 1 }}
                />
                <span style={{ fontSize: 14, fontWeight: 600, color: C.text3, letterSpacing: '-0.2px', paddingBottom: 3 }}>USDC</span>
                {balance != null && parsed > 0 && (
                  <button
                    onClick={() => balance && setAmount(balance.toFixed(2))}
                    style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: C.text3, background: C.surfaceHi, border: `1px solid ${C.border}`, borderRadius: 4, padding: '3px 6px', cursor: 'pointer', fontFamily: 'inherit', textTransform: 'uppercase' }}
                  >
                    Max
                  </button>
                )}
              </div>
            </Section>

            {/* Arrow */}
            <div style={{ display: 'flex', justifyContent: 'center', margin: '2px 0', position: 'relative' }}>
              <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: 1, background: C.border }} />
              <div style={{ position: 'relative', zIndex: 1, width: 28, height: 28, borderRadius: '50%', background: C.bg, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                  <path d="M5.5 1.5v8M2 7l3.5 3.5L9 7" stroke={C.text3} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            </div>

            {/* TO */}
            <Section label="To">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <img src="/logo-1.png" width={30} height={30} style={{ borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} alt="Arc Network" />
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: C.text1, letterSpacing: '-0.2px' }}>Arc Network</div>
                    <div style={{ fontSize: 11, color: C.text3, marginTop: 2, fontFamily: "'JetBrains Mono', monospace" }}>Chain 5042</div>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-1.2px', color: parsed > 0 ? C.text2 : C.text3, fontFamily: 'inherit', lineHeight: 1 }}>
                    {parsed > 0 ? parsed.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                  </div>
                  <div style={{ fontSize: 11, color: C.text3, marginTop: 3, fontFamily: "'JetBrains Mono', monospace" }}>USDC</div>
                </div>
              </div>
            </Section>

            {/* Approval / bridge progress */}
            {step !== 'idle' && (
              <div style={{ marginTop: 2, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px', animation: 'up 0.18s ease' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: step === 'done' ? C.green : C.text1 }}>
                    {step === 'done' ? 'Submitted to Circle CCTP' : 'Transaction in progress'}
                  </span>
                  {step === 'done' && (
                    <button onClick={reset} style={{ fontSize: 11, color: C.text3, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>Reset</button>
                  )}
                </div>
                {[
                  { label: 'Approve USDC',       active: step === 'approving', done: ['bridging','done'].includes(step) },
                  { label: 'Deposit via CCTP',   active: step === 'bridging',  done: step === 'done' },
                  { label: 'Relay to Arc',        active: false,                done: step === 'done' },
                ].map((s, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: i < 2 ? 8 : 0 }}>
                    <div style={{ width: 16, height: 16, borderRadius: '50%', border: `1px solid ${s.done ? C.green : s.active ? C.borderHi : C.border}`, background: s.done ? C.green : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.2s' }}>
                      {s.done   && <svg width="7" height="6" viewBox="0 0 7 6"><path d="M1 3l2 2 3-4" stroke={C.bg} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>}
                      {s.active && <div style={{ width: 5, height: 5, border: `1.5px solid ${C.text3}`, borderTopColor: C.text1, borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />}
                    </div>
                    <span style={{ fontSize: 12, color: s.done ? C.text3 : s.active ? C.text1 : C.text3, fontWeight: s.active ? 500 : 400 }}>{s.label}</span>
                    {s.active && !s.done && <span style={{ fontSize: 11, color: C.text3, marginLeft: 'auto', animation: 'pulse 1.5s ease infinite' }}>waiting…</span>}
                  </div>
                ))}
                {bridgeTx && (
                  <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: C.text3, fontFamily: "'JetBrains Mono', monospace" }}>{bridgeTx.slice(0,18)}…</span>
                    <a href={`https://etherscan.io/tx/${bridgeTx}`} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: C.text2, display: 'flex', alignItems: 'center', gap: 3 }}>
                      Etherscan
                      <svg width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M1.5 7.5L7.5 1.5M4 1.5h3.5V5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </a>
                  </div>
                )}
              </div>
            )}

            {/* CTA */}
            <div style={{ marginTop: 8 }}>
              <Btn label={ctaLabel()} active={ctaActive()} loading={inFlight && !bridgeConfirmed && !approveConfirmed} onClick={handleCta} />
            </div>

            <p style={{ textAlign: 'center', fontSize: 11, color: C.text3, marginTop: 12, letterSpacing: '0.01em' }}>
              Non-custodial · Secured by{' '}
              <a href="https://www.circle.com/cctp" target="_blank" rel="noreferrer" style={{ textDecoration: 'underline', textDecorationColor: C.border }}>Circle CCTP</a>
            </p>
          </div>

          {/* Right: stats */}
          <div style={{ paddingTop: 8 }}>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', color: C.text3, textTransform: 'uppercase', marginBottom: 24 }}>Stats</p>
            {[
              { label: 'Total bridged',   value: '$24.8M', sub: 'all time' },
              { label: 'Transactions',    value: '18,402', sub: 'all time' },
              { label: 'Avg. bridge time',value: '14 min', sub: 'last 24h' },
            ].map(s => (
              <div key={s.label} style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.8px', color: C.text1, lineHeight: 1 }}>{s.value}</div>
                <div style={{ fontSize: 12, color: C.text3, marginTop: 4 }}>{s.label} <span style={{ color: C.text3, opacity: 0.5 }}>· {s.sub}</span></div>
              </div>
            ))}
            <div style={{ marginTop: 12, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', color: C.text3, textTransform: 'uppercase', marginBottom: 12 }}>Allowance</div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: allowance > 0 ? C.green : C.text3 }}>
                {allowance > 0 ? `${allowance.toLocaleString('en', { maximumFractionDigits: 2 })} USDC` : 'Not approved'}
              </div>
            </div>
          </div>

        </div>
      </div>
    </>
  )
}

/* ── helpers ──────────────────────────────────────────────────────── */

function Section({ label, children, border, focused }: { label: string; children: React.ReactNode; border?: boolean; focused?: boolean }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${focused && border ? C.borderHi : C.border}`, borderRadius: 10, padding: '16px', transition: 'border-color 0.15s', marginBottom: 2 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: C.text3, textTransform: 'uppercase', marginBottom: 12 }}>{label}</div>
      {children}
    </div>
  )
}

function RouteStep({ icon, name, sub, connector }: { icon: React.ReactNode; name: string; sub: string; connector?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 10, paddingBottom: connector ? 16 : 0, position: 'relative' }}>
      {connector && <div style={{ position: 'absolute', left: 14, top: 30, width: 1, height: 'calc(100% - 14px)', background: C.border }} />}
      <div style={{ flexShrink: 0, zIndex: 1 }}>{icon}</div>
      <div style={{ paddingTop: 2 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.text1, letterSpacing: '-0.2px' }}>{name}</div>
        <div style={{ fontSize: 11, color: C.text3, marginTop: 2, fontFamily: "'JetBrains Mono', monospace" }}>{sub}</div>
      </div>
    </div>
  )
}

function Btn({ onClick, label, active, loading }: { onClick?: () => void; label: string; active: boolean; loading?: boolean }) {
  const [hover, setHover] = useState(false)
  return (
    <button
      onClick={active ? onClick : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ width: '100%', padding: '12px 16px', borderRadius: 8, border: 'none', background: active ? (hover ? '#e4e4e7' : C.text1) : C.surfaceHi, color: active ? C.bg : C.text3, fontSize: 13, fontWeight: 650, letterSpacing: '-0.2px', cursor: active ? 'pointer' : 'default', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'background 0.1s' }}
    >
      {loading && <span style={{ width: 12, height: 12, border: `1.5px solid ${active ? 'rgba(0,0,0,0.25)' : C.text3}`, borderTopColor: active ? C.bg : C.text2, borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />}
      {label}
    </button>
  )
}
