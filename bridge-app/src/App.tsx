import { useState, useRef, useEffect } from 'react'
import { useAccount, useBalance, useSwitchChain, useChainId, useConnect, useDisconnect } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { formatUnits } from 'viem'
import { mainnet, TOKENS } from './wagmiConfig'

type Token = (typeof TOKENS)[number]
type Tab = 'bridge' | 'activity'

const MOCK_ACTIVITY = [
  { hash: '0x3fa8…c21d', amount: '1.2', symbol: 'ETH',  status: 'confirmed', age: '12m ago' },
  { hash: '0x9b12…04f1', amount: '500', symbol: 'USDC', status: 'confirmed', age: '2h ago'  },
  { hash: '0x44cc…7e3a', amount: '0.45', symbol: 'ETH', status: 'pending',   age: '5h ago'  },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('bridge')
  const [amount, setAmount] = useState('')
  const [token, setToken] = useState<Token>(TOKENS[0])
  const [tokenMenuOpen, setTokenMenuOpen] = useState(false)
  const [step, setStep] = useState<number | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const { address, isConnected } = useAccount()
  const { connect } = useConnect()
  const { disconnect } = useDisconnect()
  const chainId = useChainId()
  const { switchChain, isPending: isSwitching } = useSwitchChain()
  const { data: ethBal } = useBalance({ address, chainId: mainnet.id })

  const balance = token.symbol === 'ETH' ? ethBal : null
  const balDisplay = balance
    ? parseFloat(formatUnits(balance.value, balance.decimals)).toFixed(6)
    : null

  const parsed = parseFloat(amount) || 0
  const isOnMainnet = chainId === mainnet.id
  const insufficient = balance != null && parsed > 0
    ? parsed > parseFloat(formatUnits(balance.value, balance.decimals))
    : false

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setTokenMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function handleMax() {
    if (!balance) return
    setAmount(formatUnits(balance.value, balance.decimals))
  }

  function handleBridge() {
    if (!isConnected || !isOnMainnet || !amount || insufficient) return
    const startStep = token.symbol !== 'ETH' ? 0 : 1
    setStep(startStep)
    const fake = '0x' + Array.from({ length: 64 }, () =>
      Math.floor(Math.random() * 16).toString(16)).join('')
    setTimeout(() => { setTxHash(fake); setStep(2) }, 2000)
  }

  function handleReset() { setStep(null); setTxHash(null); setAmount('') }

  const canBridge = isConnected && isOnMainnet && parsed > 0 && !insufficient && step === null

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Nav
        address={address}
        isConnected={isConnected}
        onConnect={() => connect({ connector: injected() })}
        onDisconnect={() => disconnect()}
      />

      <main style={{ flex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '48px 16px 80px' }}>
        <div style={{ width: '100%', maxWidth: 440 }}>

          {/* Page header */}
          <div style={{ marginBottom: 32 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={mono(10, '#2e3040')}>SYS://BRIDGE</span>
              <span style={{ ...mono(10, '#1a2540'), background: 'rgba(77,124,254,0.06)', border: '1px solid rgba(77,124,254,0.12)', borderRadius: 3, padding: '1px 6px' }}>v1.0</span>
            </div>
            <h1 style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.5px', color: '#e2e4ec', lineHeight: 1.2 }}>
              Cross-Chain Transfer
            </h1>
            <p style={{ marginTop: 4, fontSize: 12.5, color: '#3a3d50', letterSpacing: '0.01em' }}>
              Ethereum Mainnet → Robinhood Chain · Arbitrum Orbit
            </p>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #1a1a20', marginBottom: 24 }}>
            {(['bridge', 'activity'] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: '8px 14px', fontSize: 12, fontWeight: 500,
                  letterSpacing: '0.06em', textTransform: 'uppercase',
                  color: tab === t ? '#e2e4ec' : '#2e3040',
                  borderBottom: tab === t ? '1px solid #4d7cfe' : '1px solid transparent',
                  marginBottom: -1, transition: 'color 0.15s',
                }}
              >
                {t}
              </button>
            ))}
          </div>

          {tab === 'bridge' && (
            <>
              {/* Route indicator */}
              <div style={panel(false)}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <RouteChain label="Ethereum" id="1" color="#5a6fff" />
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                    <svg width="28" height="12" viewBox="0 0 28 12" fill="none">
                      <path d="M2 6h24M20 2l6 4-6 4" stroke="#1a1a20" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <span style={mono(9, '#1e2030')}>BRIDGE</span>
                  </div>
                  <RouteChain label="Robinhood Chain" id="1996" color="#4d7cfe" right />
                </div>
              </div>

              {/* Amount input */}
              <div style={{ ...panel(false), marginTop: 2 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <span style={mono(10, '#2e3040')}>AMOUNT</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {balDisplay != null && (
                      <span style={mono(10, '#2a2d3e')}>BAL: {balDisplay} {token.symbol}</span>
                    )}
                    {balance && (
                      <button onClick={handleMax} style={{ ...mono(9, '#4d7cfe'), background: 'rgba(77,124,254,0.06)', border: '1px solid rgba(77,124,254,0.15)', borderRadius: 3, padding: '2px 7px', cursor: 'pointer', letterSpacing: '0.08em' }}>
                        MAX
                      </button>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {/* Token selector */}
                  <div ref={menuRef} style={{ position: 'relative', flexShrink: 0 }}>
                    <button
                      onClick={() => setTokenMenuOpen(v => !v)}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#0a0a0c', border: '1px solid #1a1a20', borderRadius: 6, padding: '8px 10px', cursor: 'pointer' }}
                    >
                      <TokenDot symbol={token.symbol} />
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#c8cad8', letterSpacing: '0.02em' }}>{token.symbol}</span>
                      <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
                        <path d="M1 1l4 4 4-4" stroke="#2e3040" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>

                    {tokenMenuOpen && (
                      <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, background: '#0a0a0c', border: '1px solid #1a1a20', borderRadius: 8, overflow: 'hidden', zIndex: 50, minWidth: 160, boxShadow: '0 16px 40px rgba(0,0,0,0.6)' }}>
                        {TOKENS.map((t, i) => (
                          <button
                            key={t.symbol}
                            onClick={() => { setToken(t); setTokenMenuOpen(false) }}
                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '9px 12px', background: t.symbol === token.symbol ? '#0f0f14' : 'transparent', border: 'none', borderTop: i > 0 ? '1px solid #111116' : 'none', cursor: 'pointer' }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <TokenDot symbol={t.symbol} />
                              <span style={{ fontSize: 12, fontWeight: 600, color: t.symbol === token.symbol ? '#e2e4ec' : '#5a5d6e', letterSpacing: '0.03em' }}>{t.symbol}</span>
                            </div>
                            <span style={mono(10, '#1e2030')}>{t.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <input
                    type="number"
                    placeholder="0.000000"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: '#e2e4ec', fontSize: 22, fontWeight: 300, fontFamily: 'inherit', textAlign: 'right', letterSpacing: '-0.3px' }}
                  />
                </div>

                {insufficient && (
                  <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 3, height: 3, borderRadius: '50%', background: '#e05252', flexShrink: 0 }} />
                    <span style={mono(10, '#e05252')}>INSUFFICIENT BALANCE</span>
                  </div>
                )}
              </div>

              {/* Receive estimate */}
              <div style={{ ...panel(false), marginTop: 2 }}>
                <DataRow label="RECEIVE ON ROBINHOOD CHAIN" value={parsed > 0 ? `${parsed.toFixed(6)} ${token.symbol}` : '—'} highlight />
                <DataRow label="ESTIMATED TIME" value="~15 min" />
                <DataRow label="BRIDGE FEE" value="0.00 ETH" />
                <DataRow label="PROTOCOL" value="Arbitrum Orbit Native Bridge" mono />
              </div>

              {/* Bridge progress */}
              {step !== null && (
                <div style={{ ...panel(true), marginTop: 2 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <span style={mono(10, step >= 3 ? '#2ecc71' : '#4d7cfe')}>
                      {step >= 3 ? 'TRANSFER COMPLETE' : 'TRANSFER IN PROGRESS'}
                    </span>
                    {step >= 3 && (
                      <button onClick={handleReset} style={{ ...mono(10, '#2e3040'), background: 'none', border: 'none', cursor: 'pointer' }}>
                        NEW TRANSFER
                      </button>
                    )}
                  </div>
                  <ProgressSteps step={step} />
                  {txHash && (
                    <div style={{ marginTop: 14, padding: '8px 10px', background: '#050507', border: '1px solid #111116', borderRadius: 5 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={mono(10, '#1e2030')}>TX HASH</span>
                        <a href={`https://etherscan.io/tx/${txHash}`} target="_blank" rel="noreferrer" style={{ ...mono(10, '#4d7cfe'), textDecoration: 'none' }}>
                          ETHERSCAN ↗
                        </a>
                      </div>
                      <div style={{ ...mono(11, '#3a3d50'), marginTop: 4, wordBreak: 'break-all' }}>
                        {txHash.slice(0, 32)}…
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* CTA */}
              {step === null && (
                <div style={{ marginTop: 2 }}>
                  {!isConnected ? (
                    <Cta onClick={() => connect({ connector: injected() })} label="CONNECT WALLET" variant="primary" />
                  ) : !isOnMainnet ? (
                    <Cta onClick={() => switchChain({ chainId: mainnet.id })} label={isSwitching ? 'SWITCHING NETWORK…' : 'SWITCH TO ETHEREUM MAINNET'} variant="warning" disabled={isSwitching} />
                  ) : (
                    <Cta
                      onClick={handleBridge}
                      label={insufficient ? 'INSUFFICIENT BALANCE' : token.symbol !== 'ETH' ? 'APPROVE & INITIATE BRIDGE' : 'INITIATE BRIDGE TRANSFER'}
                      variant={canBridge ? 'primary' : 'disabled'}
                      disabled={!canBridge}
                    />
                  )}
                </div>
              )}

              {/* Chain specs */}
              <div style={{ marginTop: 20, padding: '12px 0', borderTop: '1px solid #0f0f12' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  {[
                    { k: 'CHAIN ID', v: '1996' },
                    { k: 'BLOCK TIME', v: '~2s' },
                    { k: 'FINALITY', v: 'L1 ~7d' },
                    { k: 'STACK', v: 'Orbit' },
                  ].map(({ k, v }) => (
                    <div key={k} style={{ textAlign: 'center' }}>
                      <div style={mono(9, '#1e2030')}>{k}</div>
                      <div style={{ ...mono(11, '#3a3d50'), marginTop: 3 }}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {tab === 'activity' && <ActivityFeed />}
        </div>
      </main>
    </div>
  )
}

/* ─── Sub-components ─────────────────────────────────────────── */

function Nav({ address, isConnected, onConnect, onDisconnect }: {
  address?: `0x${string}`; isConnected: boolean;
  onConnect: () => void; onDisconnect: () => void;
}) {
  return (
    <header style={{ borderBottom: '1px solid #0f0f12', padding: '0 20px' }}>
      <div style={{ maxWidth: 440 + 40, margin: '0 auto', height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, border: '1px solid #1a1a20', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0c' }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="1" y="1" width="5" height="5" stroke="#2e3a60" strokeWidth="1"/>
              <rect x="8" y="1" width="5" height="5" stroke="#4d7cfe" strokeWidth="1"/>
              <rect x="1" y="8" width="5" height="5" stroke="#4d7cfe" strokeWidth="1" opacity="0.4"/>
              <rect x="8" y="8" width="5" height="5" stroke="#2e3a60" strokeWidth="1"/>
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#c8cad8', letterSpacing: '-0.2px' }}>RHO Bridge</div>
            <div style={mono(9, '#1e2030')}>ETH / ROBINHOOD CHAIN</div>
          </div>
        </div>

        {/* Network + wallet */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 8px', border: '1px solid #111116', borderRadius: 4 }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#2ecc71' }} />
            <span style={mono(9, '#1e2030')}>MAINNET</span>
          </div>
          <button
            onClick={isConnected ? onDisconnect : onConnect}
            style={{ background: isConnected ? '#0a0a0c' : '#0d1626', border: `1px solid ${isConnected ? '#1a1a20' : '#1e2e50'}`, borderRadius: 5, padding: '5px 12px', cursor: 'pointer' }}
          >
            <span style={mono(10, isConnected ? '#3a3d50' : '#4d7cfe')}>
              {isConnected ? `${address?.slice(0, 6)}…${address?.slice(-4)}` : 'CONNECT'}
            </span>
          </button>
        </div>
      </div>
    </header>
  )
}

function RouteChain({ label, id, color, right }: { label: string; id: string; color: string; right?: boolean }) {
  return (
    <div style={{ textAlign: right ? 'right' : 'left' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, justifyContent: right ? 'flex-end' : 'flex-start', marginBottom: 3 }}>
        <div style={{ width: 6, height: 6, borderRadius: 1, background: color, opacity: 0.6 }} />
        <span style={mono(9, '#2e3040')}>CHAIN {id}</span>
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#8a8d9e', letterSpacing: '0.01em' }}>{label}</div>
    </div>
  )
}

function TokenDot({ symbol }: { symbol: string }) {
  const colors: Record<string, string> = { ETH: '#627eea', USDC: '#2775ca', USDT: '#26a17b' }
  return <div style={{ width: 7, height: 7, borderRadius: '50%', background: colors[symbol] ?? '#444', flexShrink: 0 }} />
}

function DataRow({ label, value, highlight, mono: isMono }: { label: string; value: string; highlight?: boolean; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid #0a0a0e' }}>
      <span style={{ fontSize: 10, fontFamily: 'inherit', letterSpacing: '0.08em', color: '#2e3040', fontWeight: 500 }}>{label}</span>
      <span style={isMono ? mono(10, '#3a3d50') : { fontSize: 12, color: highlight ? '#c8cad8' : '#3a3d50', fontWeight: highlight ? 500 : 400 }}>{value}</span>
    </div>
  )
}

const STEP_LABELS = ['Token approval', 'Initiate transfer', 'Relay in progress', 'Confirmed on L2']

function ProgressSteps({ step }: { step: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {STEP_LABELS.map((label, i) => {
        const done = step > i
        const active = step === i
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 18, height: 18, borderRadius: 3, flexShrink: 0, border: `1px solid ${done ? '#4d7cfe' : active ? '#2e3a60' : '#111116'}`, background: done ? 'rgba(77,124,254,0.1)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {done
                ? <svg width="9" height="7" viewBox="0 0 9 7" fill="none"><path d="M1 3.5l2.5 2.5L8 1" stroke="#4d7cfe" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                : active
                  ? <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#4d7cfe', animation: 'pulse 1.4s ease-in-out infinite' }} />
                  : <div style={{ width: 3, height: 3, borderRadius: '50%', background: '#1a1a20' }} />
              }
            </div>
            <span style={{ fontSize: 11.5, color: done ? '#5a5d6e' : active ? '#c8cad8' : '#1e2030', fontWeight: active ? 500 : 400 }}>{label}</span>
            {active && <span style={mono(9, '#4d7cfe')}>PROCESSING</span>}
          </div>
        )
      })}
    </div>
  )
}

function Cta({ onClick, label, variant, disabled }: { onClick: () => void; label: string; variant: 'primary' | 'warning' | 'disabled'; disabled?: boolean }) {
  const styles: Record<string, React.CSSProperties> = {
    primary:  { background: '#0d1626', border: '1px solid #1e2e50', color: '#4d7cfe' },
    warning:  { background: '#161206', border: '1px solid #2e2506', color: '#b88a1a' },
    disabled: { background: '#080809', border: '1px solid #0f0f12', color: '#1e2030' },
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ width: '100%', padding: '13px 16px', borderRadius: 7, cursor: disabled ? 'not-allowed' : 'pointer', transition: 'border-color 0.15s', ...styles[variant], ...mono(11, undefined), letterSpacing: '0.1em' }}
    >
      {label}
    </button>
  )
}

function ActivityFeed() {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <span style={mono(10, '#2e3040')}>RECENT TRANSFERS</span>
        <span style={mono(9, '#1a1a20')}>CHAIN 1 → 1996</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {MOCK_ACTIVITY.map((tx, i) => (
          <div key={i} style={{ padding: '11px 12px', background: '#0a0a0c', border: '1px solid #111116', borderRadius: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <TokenDot symbol={tx.symbol} />
                <span style={{ fontSize: 13, fontWeight: 600, color: '#c8cad8' }}>{tx.amount} {tx.symbol}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 4, height: 4, borderRadius: '50%', background: tx.status === 'confirmed' ? '#2ecc71' : '#b88a1a' }} />
                <span style={mono(9, tx.status === 'confirmed' ? '#1e4028' : '#2e2006')}>{tx.status.toUpperCase()}</span>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={mono(10, '#1e2030')}>{tx.hash}</span>
              <span style={mono(10, '#1a1a20')}>{tx.age}</span>
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12, textAlign: 'center' }}>
        <span style={mono(10, '#1a1a20')}>SHOWING 3 OF 3 TRANSFERS</span>
      </div>
    </div>
  )
}

/* ─── Helpers ─────────────────────────────────────────────────── */

function panel(accent: boolean): React.CSSProperties {
  return {
    background: '#0a0a0c',
    border: `1px solid ${accent ? '#111826' : '#111116'}`,
    borderRadius: 8,
    padding: '14px',
    marginBottom: 0,
  }
}

function mono(size: number, color: string | undefined): React.CSSProperties {
  return {
    fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace",
    fontSize: size,
    color: color ?? 'inherit',
    fontWeight: 400,
    letterSpacing: '0.04em',
  }
}
