import { useState, useEffect, useRef } from 'react'
import {
  useAccount, useReadContract, useSwitchChain,
  useChainId, useConnect, useDisconnect,
} from 'wagmi'
import { injected } from 'wagmi/connectors'
import { formatUnits } from 'viem'
import { mainnet, USDC_ADDRESS } from './wagmiConfig'

const ERC20_ABI = [{
  name: 'balanceOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'account', type: 'address' }],
  outputs: [{ name: '', type: 'uint256' }],
}] as const

/* ─── tiny hooks ──────────────────────────────────────────────────── */
function useMounted() {
  const [m, setM] = useState(false)
  useEffect(() => setM(true), [])
  return m
}

/* ─── design tokens ───────────────────────────────────────────────── */
const C = {
  bg:       '#0c0c0e',
  surface:  '#111114',
  surfaceHi:'#161619',
  border:   '#1e1e22',
  borderHi: '#2a2a30',
  text1:    '#ececed',
  text2:    '#8b8b93',
  text3:    '#44444c',
  green:    '#4ade80',
  red:      '#f87171',
  accent:   '#ececed',
} as const

/* ─── global styles injected once ────────────────────────────────── */
const GLOBAL_CSS = `
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  * { box-sizing: border-box; }
  input[type=number]::-webkit-outer-spin-button,
  input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; }
  input[type=number] { -moz-appearance: textfield; }
  input:focus { outline: none; }
  ::selection { background: rgba(255,255,255,0.1); }
`

export default function App() {
  const mounted = useMounted()
  const [amount, setAmount] = useState('')
  const [focused, setFocused] = useState(false)
  const [phase, setPhase]   = useState<'idle'|'bridging'|'relaying'|'done'>('idle')
  const [txHash, setTxHash] = useState<string|null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const { address, isConnected } = useAccount()
  const { connect }    = useConnect()
  const { disconnect } = useDisconnect()
  const chainId        = useChainId()
  const { switchChain, isPending: switching } = useSwitchChain()

  const { data: usdcRaw } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: mainnet.id,
    query: { enabled: !!address },
  })

  const usdcBalance = usdcRaw != null ? +formatUnits(usdcRaw as bigint, 6) : null
  const parsed      = parseFloat(amount) || 0
  const onMainnet   = chainId === mainnet.id
  const tooMuch     = usdcBalance != null && parsed > usdcBalance
  const canBridge   = isConnected && onMainnet && parsed > 0 && !tooMuch && phase === 'idle'
  const phaseIdx    = ['bridging','relaying','done'].indexOf(phase)

  function startBridge() {
    if (!canBridge) return
    setPhase('bridging')
    const h = '0x' + Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2,'0')).join('')
    setTimeout(() => { setTxHash(h); setPhase('relaying') }, 1600)
    setTimeout(() => setPhase('done'), 5000)
  }

  function reset() { setPhase('idle'); setTxHash(null); setAmount('') }

  const balFmt = usdcBalance != null
    ? usdcBalance.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : null

  return (
    <>
      <style>{GLOBAL_CSS}</style>
      <div style={{ minHeight: '100vh', background: C.bg, color: C.text1, fontFamily: "'Inter', system-ui, sans-serif", WebkitFontSmoothing: 'antialiased', MozOsxFontSmoothing: 'grayscale' }}>

        {/* ── Nav ─────────────────────────────────────────────── */}
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 32px', height: 56, borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M9 2L16 14H2L9 2Z" fill={C.text1} />
            </svg>
            <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.3px', color: C.text1 }}>ArcBridge</span>
          </div>

          <button
            onClick={isConnected ? () => disconnect() : () => connect({ connector: injected() })}
            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 13px', borderRadius: 7, border: `1px solid ${C.border}`, background: 'transparent', color: C.text2, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', transition: 'color 0.1s, border-color 0.1s' }}
            onMouseEnter={e => { (e.target as HTMLElement).style.color = C.text1; (e.target as HTMLElement).style.borderColor = C.borderHi }}
            onMouseLeave={e => { (e.target as HTMLElement).style.color = C.text2; (e.target as HTMLElement).style.borderColor = C.border }}
          >
            {isConnected && <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: C.green, flexShrink: 0 }} />}
            <span style={{ fontFamily: isConnected ? "'JetBrains Mono', monospace" : 'inherit', fontSize: isConnected ? 12 : 13 }}>
              {isConnected ? `${address?.slice(0,6)}…${address?.slice(-4)}` : 'Connect wallet'}
            </span>
          </button>
        </header>

        {/* ── Page ────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '64px 16px 80px' }}>

          {/* Eyebrow */}
          <div style={{ opacity: mounted ? 1 : 0, transform: mounted ? 'none' : 'translateY(4px)', transition: 'opacity 0.3s, transform 0.3s', marginBottom: 40, textAlign: 'center' }}>
            <p style={{ fontSize: 12, fontWeight: 500, letterSpacing: '0.08em', color: C.text3, textTransform: 'uppercase', margin: 0 }}>
              Ethereum → Arc Network · Circle CCTP
            </p>
          </div>

          {/* ── Card ────────────────────────────────────────── */}
          <div style={{ width: '100%', maxWidth: 440, opacity: mounted ? 1 : 0, transform: mounted ? 'none' : 'translateY(8px)', transition: 'opacity 0.35s 0.05s, transform 0.35s 0.05s' }}>
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>

              {/* Amount input — the hero of the card */}
              <div
                onClick={() => inputRef.current?.focus()}
                style={{ padding: '28px 24px 22px', borderBottom: `1px solid ${focused ? C.borderHi : C.border}`, cursor: 'text', transition: 'border-color 0.15s' }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
                  <ChainRow
                    logo="https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png"
                    logoRadius="50%"
                    name="Ethereum"
                    sub="Mainnet"
                  />
                  {balFmt && (
                    <button
                      onClick={e => { e.stopPropagation(); usdcBalance && setAmount(usdcBalance.toFixed(2)) }}
                      style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: C.text3, fontFamily: 'inherit' }}
                    >
                      <span style={{ fontSize: 12, color: tooMuch ? C.red : C.text3 }}>
                        {balFmt}
                      </span>
                      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', color: C.text3, background: C.surfaceHi, border: `1px solid ${C.border}`, borderRadius: 4, padding: '2px 5px' }}>MAX</span>
                    </button>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <input
                    ref={inputRef}
                    type="number"
                    placeholder="0"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: 42, fontWeight: 700, letterSpacing: '-2px', color: tooMuch ? C.red : C.text1, fontFamily: 'inherit', minWidth: 0, lineHeight: 1 }}
                  />
                  <span style={{ fontSize: 15, fontWeight: 600, color: C.text3, letterSpacing: '-0.3px', paddingBottom: 4, flexShrink: 0 }}>USDC</span>
                </div>
              </div>

              {/* Divider with arrow */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 24px', borderBottom: `1px solid ${C.border}`, background: C.surfaceHi }}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M6 1v10M2 7.5L6 11l4-3.5" stroke={C.text3} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span style={{ fontSize: 11, color: C.text3, letterSpacing: '0.03em' }}>You receive on Arc</span>
                <span style={{ marginLeft: 'auto', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: parsed > 0 ? C.text2 : C.text3, letterSpacing: '-0.3px' }}>
                  {parsed > 0 ? parsed.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'} USDC
                </span>
              </div>

              {/* TO chain */}
              <div style={{ padding: '18px 24px', borderBottom: `1px solid ${C.border}` }}>
                <ChainRow
                  logo="/logo-1.png"
                  logoRadius="8px"
                  name="Arc Network"
                  sub="Chain ID 5042"
                />
              </div>

              {/* Details */}
              <div style={{ padding: '4px 0', borderBottom: `1px solid ${C.border}` }}>
                {([
                  ['Network fee',       '0.00 USDC',    C.green],
                  ['Minter capacity',   '— USDC',       C.text2],
                  ['Estimated time',    '~15 min',      C.text2],
                  ['Router',           'Circle CCTP',  C.text2],
                ] as [string, string, string][]).map(([label, val, color]) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 24px' }}>
                    <span style={{ fontSize: 12, color: C.text3 }}>{label}</span>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color, letterSpacing: '-0.2px' }}>{val}</span>
                  </div>
                ))}
              </div>

              {/* Progress (when bridging) */}
              {phase !== 'idle' && (
                <div style={{ padding: '16px 24px', borderBottom: `1px solid ${C.border}`, animation: 'fadeUp 0.2s ease' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: phase === 'done' ? C.green : C.text1 }}>
                      {phase === 'done' ? 'Transfer complete' : 'In progress'}
                    </span>
                    {phase === 'done' && (
                      <button onClick={reset} style={{ fontSize: 11, color: C.text3, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                        New transfer
                      </button>
                    )}
                  </div>
                  {['Submitting to Circle CCTP', 'Relay in progress', 'Minted on Arc'].map((label, i) => {
                    const done   = phaseIdx > i
                    const active = phaseIdx === i
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: i < 2 ? 8 : 0 }}>
                        <div style={{ width: 16, height: 16, borderRadius: '50%', flexShrink: 0, border: `1px solid ${done ? C.green : active ? C.borderHi : C.border}`, background: done ? C.green : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}>
                          {done && <svg width="7" height="6" viewBox="0 0 7 6" fill="none"><path d="M1 3l2 2 3-4" stroke={C.bg} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                          {active && <div style={{ width: 5, height: 5, border: `1.5px solid ${C.text2}`, borderTopColor: C.text1, borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />}
                        </div>
                        <span style={{ fontSize: 12, color: done ? C.text3 : active ? C.text1 : C.text3, fontWeight: active ? 500 : 400 }}>{label}</span>
                      </div>
                    )
                  })}
                  {txHash && (
                    <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: C.text3 }}>{txHash.slice(0,20)}…</span>
                      <a href={`https://explorer.arc.io/tx/${txHash}`} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: C.text2, display: 'flex', alignItems: 'center', gap: 3 }}>
                        Explorer
                        <svg width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M1.5 7.5L7.5 1.5M4 1.5h3.5V5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </a>
                    </div>
                  )}
                </div>
              )}

              {/* CTA */}
              <div style={{ padding: 16 }}>
                {!isConnected ? (
                  <Btn onClick={() => connect({ connector: injected() })} label="Connect wallet" variant="primary" />
                ) : !onMainnet ? (
                  <Btn onClick={() => switchChain({ chainId: mainnet.id })} label={switching ? 'Switching…' : 'Switch to Ethereum'} variant="primary" loading={switching} />
                ) : phase === 'done' ? (
                  <Btn onClick={reset} label="New transfer" variant="primary" />
                ) : phase !== 'idle' ? (
                  <Btn label="Bridging…" variant="ghost" loading />
                ) : tooMuch ? (
                  <Btn label="Insufficient balance" variant="ghost" />
                ) : (
                  <Btn onClick={canBridge ? startBridge : undefined} label="Bridge USDC" variant={canBridge ? 'primary' : 'ghost'} />
                )}
              </div>
            </div>

            {/* Footer */}
            <p style={{ textAlign: 'center', fontSize: 11, color: C.text3, marginTop: 16, letterSpacing: '0.02em' }}>
              Secured by{' '}
              <a href="https://www.circle.com/cctp" target="_blank" rel="noreferrer" style={{ color: C.text3, textDecoration: 'underline', textDecorationColor: C.border }}>
                Circle CCTP
              </a>
              {' '}· Non-custodial
            </p>
          </div>
        </div>
      </div>
    </>
  )
}

/* ── Sub-components ───────────────────────────────────────────────── */

function ChainRow({ logo, logoRadius, name, sub }: { logo: string; logoRadius: string; name: string; sub: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <img src={logo} width={28} height={28} style={{ width: 28, height: 28, borderRadius: logoRadius, objectFit: 'cover', flexShrink: 0 }} alt={name} />
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.text1, lineHeight: 1, letterSpacing: '-0.2px' }}>{name}</div>
        <div style={{ fontSize: 11, color: C.text3, marginTop: 3, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.02em' }}>{sub}</div>
      </div>
    </div>
  )
}

function Btn({ onClick, label, variant, loading }: {
  onClick?: () => void
  label: string
  variant: 'primary' | 'ghost'
  loading?: boolean
}) {
  const [hover, setHover] = useState(false)
  const isPrimary = variant === 'primary' && !!onClick

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: '100%',
        padding: '11px 16px',
        borderRadius: 8,
        border: isPrimary ? 'none' : `1px solid ${C.border}`,
        background: isPrimary
          ? (hover ? '#d4d4d8' : C.text1)
          : C.surfaceHi,
        color: isPrimary ? C.bg : C.text3,
        fontSize: 13,
        fontWeight: 600,
        letterSpacing: '-0.2px',
        cursor: onClick ? 'pointer' : 'default',
        fontFamily: 'inherit',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        transition: 'background 0.1s',
      }}
    >
      {loading && (
        <span style={{ width: 12, height: 12, border: `1.5px solid ${isPrimary ? 'rgba(0,0,0,0.3)' : C.text3}`, borderTopColor: isPrimary ? C.bg : C.text2, borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />
      )}
      {label}
    </button>
  )
}
