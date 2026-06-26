import { useState, useRef, useEffect } from 'react'
import {
  useAccount, useBalance, useSwitchChain,
  useChainId, useConnect, useDisconnect,
} from 'wagmi'
import { injected } from 'wagmi/connectors'
import { formatUnits } from 'viem'
import { mainnet, TOKENS } from './wagmiConfig'

type Token = (typeof TOKENS)[number]

/* ─── tokens ──────────────────────────────────────────────────── */
const TOKEN_COLORS: Record<string, string> = {
  ETH: '#627eea', USDC: '#2775ca', USDT: '#26a17b',
}

/* ─── main component ──────────────────────────────────────────── */
export default function App() {
  const [amount, setAmount]           = useState('')
  const [token, setToken]             = useState<Token>(TOKENS[0])
  const [tokenOpen, setTokenOpen]     = useState(false)
  const [phase, setPhase]             = useState<'idle'|'approving'|'bridging'|'relaying'|'done'>('idle')
  const [txHash, setTxHash]           = useState<string | null>(null)
  const tokenRef                       = useRef<HTMLDivElement>(null)

  const { address, isConnected }      = useAccount()
  const { connect }                   = useConnect()
  const { disconnect }                = useDisconnect()
  const chainId                       = useChainId()
  const { switchChain, isPending: switching } = useSwitchChain()
  const { data: ethBal }              = useBalance({ address, chainId: mainnet.id })

  const nativeBal  = token.symbol === 'ETH' ? ethBal : null
  const balFormatted = nativeBal
    ? (+formatUnits(nativeBal.value, nativeBal.decimals)).toFixed(4)
    : null

  const parsed      = parseFloat(amount) || 0
  const onMainnet   = chainId === mainnet.id
  const tooMuch     = nativeBal != null && parsed > 0
    ? parsed > +formatUnits(nativeBal.value, nativeBal.decimals)
    : false
  const ready       = isConnected && onMainnet && parsed > 0 && !tooMuch && phase === 'idle'

  /* close token dropdown on outside click */
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (tokenRef.current && !tokenRef.current.contains(e.target as Node))
        setTokenOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  function startBridge() {
    if (!ready) return
    if (token.symbol !== 'ETH') {
      setPhase('approving')
      setTimeout(() => runBridge(), 1800)
    } else {
      runBridge()
    }
  }

  function runBridge() {
    setPhase('bridging')
    const hash = '0x' + crypto.getRandomValues(new Uint8Array(32))
      .reduce((s, b) => s + b.toString(16).padStart(2, '0'), '')
    setTimeout(() => { setTxHash(hash); setPhase('relaying') }, 1400)
    setTimeout(() => setPhase('done'), 5000)
  }

  function reset() { setPhase('idle'); setTxHash(null); setAmount('') }

  /* ── render ─────────────────────────────────────────────────── */
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <Header isConnected={isConnected} address={address}
        onConnect={() => connect({ connector: injected() })}
        onDisconnect={disconnect} />

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 16px 80px' }}>

        {/* ── widget ─────────────────────────────────────────── */}
        <div style={{ width: '100%', maxWidth: 460 }}>

          {/* title */}
          <div style={{ marginBottom: 20 }}>
            <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--text-1)', letterSpacing: '-0.3px' }}>Bridge</h1>
            <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 2 }}>Ethereum → Robinhood Chain</p>
          </div>

          {/* card */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18, overflow: 'hidden' }}>

            {/* from */}
            <div style={{ padding: '18px 18px 14px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <ChainLabel name="Ethereum" num="1" />
                {balFormatted != null && (
                  <button
                    onClick={() => setAmount(formatUnits(nativeBal!.value, nativeBal!.decimals))}
                    style={{ fontSize: 12, color: 'var(--text-2)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                  >
                    Balance: <span style={{ color: 'var(--text-1)', fontWeight: 500 }}>{balFormatted} {token.symbol}</span>
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {/* token picker */}
                <div ref={tokenRef} style={{ position: 'relative', flexShrink: 0 }}>
                  <button
                    onClick={() => setTokenOpen(v => !v)}
                    style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'var(--surface-2)', border: '1px solid var(--border-hi)', borderRadius: 50, padding: '7px 12px 7px 9px', cursor: 'pointer' }}
                  >
                    <span style={{ width: 18, height: 18, borderRadius: '50%', background: TOKEN_COLORS[token.symbol] ?? '#555', flexShrink: 0 }} />
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>{token.symbol}</span>
                    <svg width="10" height="6" viewBox="0 0 10 6" fill="none" style={{ marginLeft: 1 }}>
                      <path d="M1 1l4 4 4-4" stroke="var(--text-3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>

                  {tokenOpen && (
                    <div className="fade-in" style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, width: 200, background: 'var(--surface-2)', border: '1px solid var(--border-hi)', borderRadius: 12, overflow: 'hidden', zIndex: 100, boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
                      {TOKENS.map((t, i) => (
                        <button
                          key={t.symbol}
                          onClick={() => { setToken(t); setTokenOpen(false) }}
                          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', background: token.symbol === t.symbol ? 'rgba(255,255,255,0.04)' : 'transparent', border: 'none', borderTop: i > 0 ? '1px solid var(--border)' : 'none', cursor: 'pointer' }}
                        >
                          <span style={{ width: 22, height: 22, borderRadius: '50%', background: TOKEN_COLORS[t.symbol] ?? '#555', flexShrink: 0 }} />
                          <div style={{ textAlign: 'left' }}>
                            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>{t.symbol}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>{t.name}</div>
                          </div>
                          {token.symbol === t.symbol && (
                            <svg style={{ marginLeft: 'auto' }} width="13" height="10" viewBox="0 0 13 10" fill="none">
                              <path d="M1 5l4 4L12 1" stroke="var(--blue)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <input
                  type="number"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder="0"
                  style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 28, fontWeight: 300, color: amount ? 'var(--text-1)' : 'var(--text-3)', textAlign: 'right', letterSpacing: '-0.5px', minWidth: 0 }}
                />
              </div>

              {tooMuch && (
                <p style={{ marginTop: 8, textAlign: 'right', fontSize: 12, color: 'var(--red)' }}>Insufficient balance</p>
              )}
            </div>

            {/* arrow */}
            <div style={{ display: 'flex', justifyContent: 'center', padding: '0', margin: '-1px 0', position: 'relative', zIndex: 1 }}>
              <div style={{ width: 32, height: 32, border: '1px solid var(--border)', borderRadius: 9, background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="12" height="14" viewBox="0 0 12 14" fill="none">
                  <path d="M6 1v12M1 9l5 5 5-5" stroke="var(--text-3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            </div>

            {/* to */}
            <div style={{ padding: '14px 18px 18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <ChainLabel name="Robinhood Chain" num="1996" accent />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ width: 18, height: 18, borderRadius: '50%', background: TOKEN_COLORS[token.symbol] ?? '#555', flexShrink: 0 }} />
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-2)' }}>{token.symbol}</span>
                </div>
                <span style={{ fontSize: 28, fontWeight: 300, color: parsed > 0 ? 'var(--text-1)' : 'var(--text-3)', letterSpacing: '-0.5px' }}>
                  {parsed > 0 ? parsed.toFixed(4) : '0'}
                </span>
              </div>
            </div>
          </div>

          {/* details */}
          {parsed > 0 && (
            <div className="fade-in" style={{ marginTop: 8, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              {[
                ['Estimated time',  '~15 minutes'],
                ['Bridge fee',      '0.00 ETH'],
                ['You receive',     `${parsed.toFixed(6)} ${token.symbol}`],
              ].map(([k, v], i) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', borderBottom: i < 2 ? '1px solid var(--border)' : 'none' }}>
                  <span style={{ fontSize: 13, color: 'var(--text-3)' }}>{k}</span>
                  <span style={{ fontSize: 13, color: i === 2 ? 'var(--text-1)' : 'var(--text-2)', fontWeight: i === 2 ? 500 : 400 }}>{v}</span>
                </div>
              ))}
            </div>
          )}

          {/* progress */}
          {phase !== 'idle' && (
            <div className="fade-in" style={{ marginTop: 8, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: phase === 'done' ? 'var(--green)' : 'var(--text-1)' }}>
                  {phase === 'done' ? 'Transfer complete' : 'Transfer in progress'}
                </span>
                {phase === 'done' && (
                  <button onClick={reset} style={{ fontSize: 12, color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer' }}>
                    New transfer
                  </button>
                )}
              </div>
              <Steps phase={phase} />
              {txHash && (
                <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8 }}>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--text-3)' }}>
                    {txHash.slice(0, 20)}…
                  </span>
                  <a href={`https://etherscan.io/tx/${txHash}`} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--blue)', display: 'flex', alignItems: 'center', gap: 3 }}>
                    Etherscan
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M2 8L8 2M4 2h4v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </a>
                </div>
              )}
            </div>
          )}

          {/* cta */}
          <div style={{ marginTop: 8 }}>
            {!isConnected ? (
              <ActionBtn onClick={() => connect({ connector: injected() })} label="Connect Wallet" variant="primary" />
            ) : !onMainnet ? (
              <ActionBtn onClick={() => switchChain({ chainId: mainnet.id })} label={switching ? 'Switching…' : 'Switch to Ethereum'} variant="warning" disabled={switching} />
            ) : phase !== 'idle' ? (
              <ActionBtn label={phase === 'done' ? 'Complete' : 'Processing…'} variant={phase === 'done' ? 'success' : 'loading'} disabled />
            ) : (
              <ActionBtn
                onClick={startBridge}
                label={tooMuch ? 'Insufficient balance' : !amount || !parsed ? 'Enter an amount' : token.symbol !== 'ETH' ? `Approve ${token.symbol} & Bridge` : 'Bridge to Robinhood Chain'}
                variant={ready ? 'primary' : 'disabled'}
                disabled={!ready}
              />
            )}
          </div>

          {/* footer */}
          <div style={{ marginTop: 24, display: 'flex', justifyContent: 'center', gap: 20 }}>
            {[
              ['Chain ID', '1996'],
              ['Stack', 'Arbitrum Orbit'],
              ['Block time', '~2s'],
            ].map(([k, v]) => (
              <div key={k} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 2 }}>{k}</div>
                <div style={{ fontSize: 12, color: 'var(--text-2)', fontWeight: 500 }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}

/* ─── Header ────────────────────────────────────────────────────── */
function Header({ isConnected, address, onConnect, onDisconnect }: {
  isConnected: boolean; address?: `0x${string}`
  onConnect: () => void; onDisconnect: () => void
}) {
  return (
    <header style={{ borderBottom: '1px solid var(--border)', padding: '0 20px', height: 56, display: 'flex', alignItems: 'center' }}>
      <div style={{ maxWidth: 460 + 40, margin: '0 auto', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          {/* geometric logo */}
          <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
            <rect x="1" y="1" width="10" height="10" rx="2.5" stroke="#00C805" strokeWidth="1.2"/>
            <rect x="15" y="1" width="10" height="10" rx="2.5" stroke="#00C805" strokeWidth="1.2" opacity=".4"/>
            <rect x="1" y="15" width="10" height="10" rx="2.5" stroke="#00C805" strokeWidth="1.2" opacity=".4"/>
            <rect x="15" y="15" width="10" height="10" rx="2.5" stroke="#00C805" strokeWidth="1.2"/>
            <path d="M11 13h4" stroke="#00C805" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)', letterSpacing: '-0.2px' }}>RHO Bridge</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isConnected && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', background: 'rgba(62,207,142,0.06)', border: '1px solid rgba(62,207,142,0.15)', borderRadius: 20 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--green)', flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 500 }}>Ethereum</span>
            </div>
          )}
          <button
            onClick={isConnected ? onDisconnect : onConnect}
            style={{ padding: '7px 14px', borderRadius: 20, border: '1px solid var(--border-hi)', background: isConnected ? 'transparent' : 'var(--blue)', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: isConnected ? 'var(--text-2)' : 'white', transition: 'opacity .15s' }}
          >
            {isConnected ? `${address?.slice(0,6)}…${address?.slice(-4)}` : 'Connect Wallet'}
          </button>
        </div>
      </div>
    </header>
  )
}

/* ─── ChainLabel ─────────────────────────────────────────────────── */
function ChainLabel({ name, num, accent }: { name: string; num: string; accent?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: accent ? 'var(--blue)' : '#555' }} />
      <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-3)' }}>{name}</span>
      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: 'var(--text-3)', opacity: 0.5 }}>#{num}</span>
    </div>
  )
}

/* ─── Steps ──────────────────────────────────────────────────────── */
type Phase = 'idle'|'approving'|'bridging'|'relaying'|'done'
const STEP_DEFS: { label: string; activeIn: Phase[] }[] = [
  { label: 'Approve token',          activeIn: ['approving'] },
  { label: 'Submit transaction',     activeIn: ['bridging'] },
  { label: 'Waiting for relay',      activeIn: ['relaying'] },
  { label: 'Confirmed on L2',        activeIn: ['done'] },
]
const PHASE_ORDER: Phase[] = ['approving','bridging','relaying','done']

function Steps({ phase }: { phase: Phase }) {
  const current = PHASE_ORDER.indexOf(phase)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      {STEP_DEFS.map((s, i) => {
        const done   = current > i
        const active = current === i
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, border: `1.5px solid ${done ? 'var(--blue)' : active ? 'var(--blue)' : 'var(--border-hi)'}`, background: done ? 'var(--blue)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .3s' }}>
              {done ? (
                <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                  <path d="M1 3.5l2.5 2.5L8 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              ) : active ? (
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--blue)', animation: 'pulse 1.2s ease infinite' }} />
              ) : (
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--border-hi)' }} />
              )}
            </div>
            <span style={{ fontSize: 13, color: done ? 'var(--text-3)' : active ? 'var(--text-1)' : 'var(--text-3)', fontWeight: active ? 500 : 400 }}>
              {s.label}
            </span>
            {active && phase !== 'done' && (
              <svg style={{ marginLeft: 'auto', animation: 'spin 1s linear infinite' }} width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M6 1a5 5 0 0 1 5 5" stroke="var(--blue)" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ─── ActionBtn ──────────────────────────────────────────────────── */
type BtnVariant = 'primary'|'disabled'|'warning'|'loading'|'success'

function ActionBtn({ onClick, label, variant, disabled }: {
  onClick?: () => void; label: string; variant: BtnVariant; disabled?: boolean
}) {
  const styles: Record<BtnVariant, React.CSSProperties> = {
    primary:  { background: 'var(--blue)',  color: 'white',           border: 'none' },
    disabled: { background: 'var(--surface-2)', color: 'var(--text-3)', border: '1px solid var(--border)' },
    warning:  { background: 'rgba(240,168,50,0.1)', color: 'var(--amber)', border: '1px solid rgba(240,168,50,0.2)' },
    loading:  { background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border)' },
    success:  { background: 'rgba(62,207,142,0.1)', color: 'var(--green)', border: '1px solid rgba(62,207,142,0.2)' },
  }
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{ width: '100%', padding: '14px', borderRadius: 12, fontSize: 15, fontWeight: 600, cursor: disabled ? 'default' : 'pointer', transition: 'opacity .15s', letterSpacing: '-0.1px', ...styles[variant] }}
    >
      {label}
    </button>
  )
}
