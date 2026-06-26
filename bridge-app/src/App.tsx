import { useState } from 'react'
import { useAccount, useBalance, useSwitchChain, useChainId, useConnect, useDisconnect } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { formatUnits } from 'viem'
import { mainnet, TOKENS } from './wagmiConfig'

type Token = (typeof TOKENS)[number]

const STEPS = ['Approve token', 'Initiate bridge', 'Waiting for relay (~15 min)', 'Complete']

export default function App() {
  const [amount, setAmount] = useState('')
  const [token, setToken] = useState<Token>(TOKENS[0])
  const [tokenMenuOpen, setTokenMenuOpen] = useState(false)
  const [step, setStep] = useState<number | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)

  const { address, isConnected } = useAccount()
  const { connect } = useConnect()
  const { disconnect } = useDisconnect()
  const chainId = useChainId()
  const { switchChain, isPending: isSwitching } = useSwitchChain()

  const { data: ethBal } = useBalance({ address, chainId: mainnet.id })
  const balance = token.symbol === 'ETH' ? ethBal : null
  const balDisplay = balance
    ? parseFloat(formatUnits(balance.value, balance.decimals)).toFixed(4)
    : '—'

  const parsed = parseFloat(amount) || 0
  const isOnMainnet = chainId === mainnet.id
  const insufficient = balance != null && parsed > 0
    ? parsed > parseFloat(formatUnits(balance.value, balance.decimals))
    : false

  function handleMax() {
    if (!balance) return
    setAmount(formatUnits(balance.value, balance.decimals))
  }

  function handleBridge() {
    if (!isConnected || !isOnMainnet || !amount || insufficient) return
    setStep(token.symbol !== 'ETH' ? 0 : 1)
    const fakeHash = '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
    setTimeout(() => { setTxHash(fakeHash); setStep(2) }, 1800)
  }

  function handleReset() {
    setStep(null); setTxHash(null); setAmount('')
  }

  const canBridge = isConnected && isOnMainnet && parsed > 0 && !insufficient && step === null

  return (
    <div style={{ minHeight: '100vh', background: '#0a0b0e', display: 'flex', flexDirection: 'column' }}>
      {/* Nav */}
      <header style={{ borderBottom: '1px solid #1e2028', padding: '0 24px' }}>
        <div style={{ maxWidth: 520, margin: '0 auto', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M2 11 Q6 11 8 8 T14 5" stroke="#4ade80" strokeWidth="2" strokeLinecap="round"/>
                <path d="M2 11 L14 11" stroke="#4ade80" strokeWidth="1.5" strokeLinecap="round" opacity="0.4"/>
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', lineHeight: 1.2 }}>RHO Bridge</div>
              <div style={{ fontSize: 10, color: '#6b7280', letterSpacing: '0.1em', textTransform: 'uppercase' }}>ETH → Robinhood Chain</div>
            </div>
          </div>
          {isConnected ? (
            <button onClick={() => disconnect()} style={btnStyle('#1e2028', '#9ca3af', '1px solid #2e3038')}>
              {address?.slice(0, 6)}…{address?.slice(-4)}
            </button>
          ) : (
            <button onClick={() => connect({ connector: injected() })} style={btnStyle('#4ade80', '#0a0b0e')}>
              Connect
            </button>
          )}
        </div>
      </header>

      {/* Main */}
      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 16px' }}>
        <div style={{ width: '100%', maxWidth: 480 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: '#f1f5f9', marginBottom: 6 }}>Bridge</h1>
          <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 24 }}>
            Transfer tokens from Ethereum Mainnet to Robinhood Chain
          </p>

          <div style={cardStyle}>
            {/* Chain route */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              <ChainBadge label="Ethereum" color="#60a5fa" />
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0 }}>
                <path d="M4 10h12M12 6l4 4-4 4" stroke="#4b5563" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <ChainBadge label="Robinhood Chain" color="#4ade80" />
            </div>

            {/* Amount input */}
            <div style={{ background: '#0d0e13', border: '1px solid #1e2028', borderRadius: 14, padding: '14px 16px', marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 12, color: '#6b7280' }}>You send</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#6b7280' }}>
                  Balance: {balDisplay}
                  {balance && (
                    <button onClick={handleMax} style={{ fontSize: 10, fontWeight: 700, color: '#4ade80', background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.25)', borderRadius: 4, padding: '1px 6px', cursor: 'pointer', letterSpacing: '0.05em' }}>
                      MAX
                    </button>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {/* Token selector */}
                <div style={{ position: 'relative' }}>
                  <button
                    onClick={() => setTokenMenuOpen(v => !v)}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#16181f', border: '1px solid #2e3038', borderRadius: 10, padding: '8px 12px', cursor: 'pointer', color: '#f1f5f9', fontSize: 14, fontWeight: 600 }}
                  >
                    {token.symbol}
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 4l4 4 4-4" stroke="#6b7280" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                  {tokenMenuOpen && (
                    <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, background: '#16181f', border: '1px solid #2e3038', borderRadius: 12, overflow: 'hidden', zIndex: 50, minWidth: 160, boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
                      {TOKENS.map(t => (
                        <button
                          key={t.symbol}
                          onClick={() => { setToken(t); setTokenMenuOpen(false) }}
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '10px 14px', background: 'transparent', border: 'none', cursor: 'pointer', color: t.symbol === token.symbol ? '#4ade80' : '#9ca3af', fontSize: 13 }}
                        >
                          <span style={{ fontWeight: 600 }}>{t.symbol}</span>
                          <span style={{ fontSize: 11, color: '#4b5563' }}>{t.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <input
                  type="number"
                  placeholder="0.00"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: '#f1f5f9', fontSize: 24, fontWeight: 700, textAlign: 'right' }}
                />
              </div>
              {insufficient && <p style={{ marginTop: 6, textAlign: 'right', fontSize: 12, color: '#f87171' }}>Insufficient balance</p>}
            </div>

            {/* Receive row */}
            <div style={{ background: '#0d0e13', border: '1px solid #1e2028', borderRadius: 14, padding: '12px 16px', marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: '#6b7280' }}>You receive on Robinhood Chain</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: '#f1f5f9' }}>
                  {parsed > 0 ? `~${parsed.toFixed(4)} ${token.symbol}` : '—'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, color: '#4b5563' }}>Estimated time</span>
                <span style={{ fontSize: 11, color: '#6b7280' }}>~15 minutes</span>
              </div>
            </div>

            {/* Progress */}
            {step !== null && (
              <div style={{ background: '#0d0e13', border: '1px solid #1e2028', borderRadius: 14, padding: '14px 16px', marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9' }}>
                    {step >= 3 ? 'Bridge complete ✓' : 'Bridging…'}
                  </span>
                  {step >= 3 && (
                    <button onClick={handleReset} style={{ fontSize: 12, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer' }}>
                      New transfer
                    </button>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {STEPS.map((label, i) => {
                    const done = step > i
                    const active = step === i
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, background: done ? '#4ade80' : active ? 'rgba(74,222,128,0.15)' : '#16181f', color: done ? '#0a0b0e' : active ? '#4ade80' : '#4b5563', border: active ? '1px solid rgba(74,222,128,0.4)' : 'none' }}>
                          {done ? '✓' : i + 1}
                        </div>
                        <span style={{ fontSize: 13, color: done ? '#9ca3af' : active ? '#f1f5f9' : '#4b5563', fontWeight: active ? 500 : 400 }}>{label}</span>
                      </div>
                    )
                  })}
                </div>
                {txHash && (
                  <div style={{ marginTop: 12, background: '#16181f', borderRadius: 8, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11, color: '#6b7280' }}>Tx:</span>
                    <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#9ca3af' }}>{txHash.slice(0, 22)}…</span>
                    <a href={`https://etherscan.io/tx/${txHash}`} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#4ade80', marginLeft: 'auto' }}>↗ View</a>
                  </div>
                )}
              </div>
            )}

            {/* CTA */}
            {step === null && (
              !isConnected ? (
                <button onClick={() => connect({ connector: injected() })} style={{ ...ctaBtn, background: '#4ade80', color: '#0a0b0e' }}>
                  Connect Wallet
                </button>
              ) : !isOnMainnet ? (
                <button onClick={() => switchChain({ chainId: mainnet.id })} disabled={isSwitching} style={{ ...ctaBtn, background: 'rgba(251,191,36,0.15)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.3)' }}>
                  {isSwitching ? 'Switching…' : 'Switch to Ethereum Mainnet'}
                </button>
              ) : (
                <button onClick={handleBridge} disabled={!canBridge} style={{ ...ctaBtn, background: canBridge ? '#4ade80' : '#1e2028', color: canBridge ? '#0a0b0e' : '#4b5563', cursor: canBridge ? 'pointer' : 'not-allowed' }}>
                  {insufficient ? 'Insufficient Balance' : token.symbol !== 'ETH' ? 'Approve & Bridge' : 'Bridge to Robinhood Chain'}
                </button>
              )
            )}
          </div>

          {/* Info */}
          <div style={{ ...cardStyle, marginTop: 12, padding: '14px 18px' }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#4b5563', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>About Robinhood Chain</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                'Ethereum L2 built on Arbitrum Orbit',
                'Low fees · ~2 second block time',
                'Chain ID: 1996 · Native token: ETH',
                'Bridged assets arrive in ~15 minutes',
              ].map(item => (
                <div key={item} style={{ display: 'flex', gap: 8, fontSize: 12, color: '#6b7280' }}>
                  <span style={{ color: '#4ade80', flexShrink: 0 }}>→</span>
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

function ChainBadge({ label, color }: { label: string; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: `${color}18`, border: `1px solid ${color}30`, borderRadius: 999, padding: '4px 10px' }}>
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
      <span style={{ fontSize: 12, fontWeight: 500, color }}>{label}</span>
    </div>
  )
}

const cardStyle: React.CSSProperties = {
  background: '#111318',
  border: '1px solid #1e2028',
  borderRadius: 20,
  padding: '20px',
}

const ctaBtn: React.CSSProperties = {
  width: '100%',
  border: 'none',
  borderRadius: 12,
  padding: '14px',
  fontSize: 15,
  fontWeight: 700,
  cursor: 'pointer',
  transition: 'opacity 0.15s',
}

function btnStyle(bg: string, color: string, border?: string): React.CSSProperties {
  return { background: bg, color, border: border ?? 'none', borderRadius: 10, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }
}
