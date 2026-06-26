import { useRef, useEffect, useState } from 'react'
import {
  useAccount, useReadContract, useSwitchChain,
  useChainId, useConnect, useDisconnect,
} from 'wagmi'
import { injected } from 'wagmi/connectors'
import { formatUnits } from 'viem'
import { mainnet, USDC_ADDRESS } from './wagmiConfig'

const ERC20_BALANCE_ABI = [{
  name: 'balanceOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'account', type: 'address' }],
  outputs: [{ name: '', type: 'uint256' }],
}] as const

export default function App() {
  const [amount, setAmount]     = useState('1000.00')
  const [phase, setPhase]       = useState<'idle'|'bridging'|'relaying'|'done'>('idle')
  const [txHash, setTxHash]     = useState<string | null>(null)

  const { address, isConnected } = useAccount()
  const { connect }              = useConnect()
  const { disconnect }           = useDisconnect()
  const chainId                  = useChainId()
  const { switchChain, isPending: switching } = useSwitchChain()

  // Fetch USDC balance on Ethereum mainnet
  const { data: usdcRaw } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_BALANCE_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: mainnet.id,
    query: { enabled: !!address },
  })

  const usdcBalance  = usdcRaw != null ? +formatUnits(usdcRaw as bigint, 6) : null
  const balDisplay   = usdcBalance != null ? usdcBalance.toFixed(2) : '0.00'

  const parsed       = parseFloat(amount) || 0
  const onMainnet    = chainId === mainnet.id
  const tooMuch      = usdcBalance != null && parsed > usdcBalance
  const canBridge    = isConnected && onMainnet && parsed > 0 && !tooMuch && phase === 'idle'

  function startBridge() {
    if (!canBridge) return
    setPhase('bridging')
    const hash = '0x' + crypto.getRandomValues(new Uint8Array(32))
      .reduce((s, b) => s + b.toString(16).padStart(2, '0'), '')
    setTimeout(() => { setTxHash(hash); setPhase('relaying') }, 1600)
    setTimeout(() => setPhase('done'), 5000)
  }

  function reset() { setPhase('idle'); setTxHash(null) }

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', display: 'flex', flexDirection: 'column' }}>

      {/* Nav */}
      <nav style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 32px', height: 64, borderBottom: '1px solid #1a1a1a' }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: '#7dd3fc', letterSpacing: '-0.3px', fontFamily: 'Inter, sans-serif' }}>
          ArcBridge
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>Bridge</span>
          <div style={{ height: 2, width: 28, background: '#fff', borderRadius: 2 }} />
        </div>
        <button
          onClick={isConnected ? () => disconnect() : () => connect({ connector: injected() })}
          style={{ background: isConnected ? 'transparent' : '#fff', color: isConnected ? '#9ca3af' : '#0a0a0a', border: isConnected ? '1px solid #2a2a2a' : 'none', borderRadius: 10, padding: '9px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}
        >
          {isConnected ? `${address?.slice(0, 6)}…${address?.slice(-4)}` : 'Connect Wallet'}
        </button>
      </nav>

      {/* Hero */}
      <div style={{ textAlign: 'center', padding: '64px 16px 40px' }}>
        <h1 style={{ fontSize: 'clamp(40px, 7vw, 72px)', fontWeight: 800, color: '#fff', letterSpacing: '-2px', lineHeight: 1.05, fontFamily: 'Inter, sans-serif', margin: 0 }}>
          Bridge Assets
        </h1>
        <p style={{ marginTop: 16, fontSize: 16, color: '#6b7280', lineHeight: 1.6, maxWidth: 480, marginInline: 'auto' }}>
          Transfer USDC seamlessly between networks with<br />sub-second finality and predictable execution.
        </p>
      </div>

      {/* Card */}
      <main style={{ display: 'flex', justifyContent: 'center', padding: '0 16px 80px' }}>
        <div style={{ width: '100%', maxWidth: 500, background: '#141414', border: '1px solid #222', borderRadius: 20, padding: '24px', fontFamily: 'Inter, sans-serif' }}>

          {/* FROM */}
          <div style={{ marginBottom: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: '#4b9fff' }}>FROM</span>
              <span style={{ fontSize: 13, color: '#6b7280' }}>
                Balance: <span style={{ color: tooMuch ? '#ef4444' : '#9ca3af' }}>{balDisplay} USDC</span>
              </span>
            </div>
            <div style={{ background: '#1e1e1e', borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <EthIcon size={36} />
                <span style={{ fontSize: 17, fontWeight: 700, color: '#fff' }}>Ethereum</span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <input
                  type="number"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  style={{ background: 'transparent', border: 'none', outline: 'none', fontSize: 22, fontWeight: 700, color: tooMuch ? '#ef4444' : '#4b5563', textAlign: 'right', width: 140, fontFamily: 'Inter, sans-serif' }}
                />
                <div style={{ fontSize: 12, color: '#4b5563', marginTop: 1 }}>USDC</div>
              </div>
            </div>
          </div>

          {/* Arrow divider */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '12px 0', position: 'relative' }}>
            <div style={{ position: 'absolute', left: 0, right: 0, height: 1, background: '#1e1e1e' }} />
            <div style={{ position: 'relative', zIndex: 1, width: 34, height: 34, borderRadius: '50%', background: '#1e1e1e', border: '1px solid #2a2a2a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path d="M6.5 1v11M2 8.5l4.5 4.5 4.5-4.5" stroke="#6b7280" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          </div>

          {/* TO */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ marginBottom: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: '#4b9fff' }}>TO</span>
            </div>
            <div style={{ background: '#1e1e1e', borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <ArcIcon size={36} />
                <span style={{ fontSize: 17, fontWeight: 700, color: '#fff' }}>Arc Network</span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#4b5563' }}>
                  {parsed > 0 ? parsed.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}
                </div>
                <div style={{ fontSize: 12, color: '#4b5563', marginTop: 1 }}>USDC</div>
              </div>
            </div>
          </div>

          {/* Details */}
          <div style={{ borderTop: '1px solid #1e1e1e', paddingTop: 16, marginBottom: 16 }}>
            {[
              { label: 'NETWORK FEE',       value: '0.00 USDC',    color: '#22c55e' },
              { label: 'CIRCLE MINTER CAP', value: '-- USDC',      color: '#4b9fff' },
              { label: 'ESTIMATED TIME',    value: '> 15 Minutes', color: '#9ca3af' },
              { label: 'ROUTER',            value: 'Circle CCTP',  color: '#9ca3af' },
            ].map(row => (
              <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 500, letterSpacing: '0.08em', color: '#3a3a3a' }}>
                  {row.label}
                </span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: row.color }}>
                  {row.value}
                </span>
              </div>
            ))}
          </div>

          {/* Progress */}
          {phase !== 'idle' && (
            <div style={{ marginBottom: 16, background: '#1e1e1e', borderRadius: 12, padding: '14px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: phase === 'done' ? '#22c55e' : '#fff' }}>
                  {phase === 'done' ? 'Transfer complete' : 'Bridging USDC…'}
                </span>
                {phase === 'done' && (
                  <button onClick={reset} style={{ fontSize: 12, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer' }}>
                    New transfer
                  </button>
                )}
              </div>
              {['Submitting to Circle CCTP', 'Relay in progress', 'Minted on Arc'].map((label, i) => {
                const idx   = ['bridging','relaying','done'].indexOf(phase)
                const done   = idx > i
                const active = idx === i
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <div style={{ width: 18, height: 18, borderRadius: '50%', border: `1.5px solid ${done ? '#22c55e' : active ? '#4b9fff' : '#2a2a2a'}`, background: done ? '#22c55e' : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {done && <svg width="9" height="7" viewBox="0 0 9 7" fill="none"><path d="M1 3.5l2.5 2.5L8 1" stroke="#0a0a0a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      {active && <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#4b9fff' }} />}
                    </div>
                    <span style={{ fontSize: 13, color: done ? '#4b5563' : active ? '#fff' : '#2a2a2a' }}>{label}</span>
                  </div>
                )
              })}
              {txHash && (
                <div style={{ marginTop: 10, fontSize: 11, color: '#4b5563', fontFamily: 'JetBrains Mono, monospace', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{txHash.slice(0, 24)}…</span>
                  <a href={`https://explorer.arc.io/tx/${txHash}`} target="_blank" rel="noreferrer" style={{ color: '#4b9fff' }}>View ↗</a>
                </div>
              )}
            </div>
          )}

          {/* CTA */}
          {!isConnected ? (
            <ActionBtn onClick={() => connect({ connector: injected() })} label="Connect Wallet" active />
          ) : !onMainnet ? (
            <ActionBtn onClick={() => switchChain({ chainId: mainnet.id })} label={switching ? 'Switching…' : 'Switch to Ethereum'} active={!switching} />
          ) : phase !== 'idle' ? (
            <ActionBtn label={phase === 'done' ? '✓ Complete' : 'Bridging…'} active={false} />
          ) : (
            <ActionBtn onClick={startBridge} label="Bridge USDC" active={canBridge} />
          )}
        </div>
      </main>
    </div>
  )
}

/* ── Chain icons ─────────────────────────────────────────────────── */
function EthIcon({ size }: { size: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current; if (!c) return
    const ctx = c.getContext('2d'); if (!ctx) return
    const d = window.devicePixelRatio || 1
    c.width = size * d; c.height = size * d; ctx.scale(d, d)
    const cx = size / 2, cy = size / 2, r = size / 2 - 1
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fillStyle = '#1a1aff'; ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.beginPath(); ctx.moveTo(cx, cy - r * 0.52); ctx.lineTo(cx - r * 0.36, cy + r * 0.02); ctx.lineTo(cx, cy + r * 0.18); ctx.lineTo(cx + r * 0.36, cy + r * 0.02); ctx.closePath(); ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.55)'
    ctx.beginPath(); ctx.moveTo(cx, cy + r * 0.18); ctx.lineTo(cx - r * 0.36, cy + r * 0.02); ctx.lineTo(cx, cy + r * 0.52); ctx.closePath(); ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.beginPath(); ctx.moveTo(cx, cy + r * 0.18); ctx.lineTo(cx + r * 0.36, cy + r * 0.02); ctx.lineTo(cx, cy + r * 0.52); ctx.closePath(); ctx.fill()
  }, [size])
  return <canvas ref={ref} width={size} height={size} style={{ width: size, height: size, borderRadius: '50%' }} />
}

function ArcIcon({ size }: { size: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current; if (!c) return
    const ctx = c.getContext('2d'); if (!ctx) return
    const d = window.devicePixelRatio || 1
    c.width = size * d; c.height = size * d; ctx.scale(d, d)
    ctx.beginPath(); ctx.roundRect(1, 1, size - 2, size - 2, size * 0.22)
    ctx.fillStyle = '#1c2a3a'; ctx.fill(); ctx.strokeStyle = '#2a3f55'; ctx.lineWidth = 1; ctx.stroke()
    const cx = size / 2, cy = size / 2, ar = size * 0.28
    ctx.beginPath(); ctx.arc(cx, cy + size * 0.06, ar, Math.PI * 1.18, Math.PI * 1.82)
    ctx.strokeStyle = '#7dd3fc'; ctx.lineWidth = size * 0.1; ctx.lineCap = 'round'; ctx.stroke()
    ctx.beginPath(); ctx.moveTo(cx - ar * 0.5, cy + size * 0.16); ctx.lineTo(cx + ar * 0.5, cy + size * 0.16)
    ctx.strokeStyle = '#7dd3fc'; ctx.lineWidth = size * 0.08; ctx.stroke()
  }, [size])
  return <canvas ref={ref} width={size} height={size} style={{ width: size, height: size, borderRadius: size * 0.22 }} />
}

/* ── Button ──────────────────────────────────────────────────────── */
function ActionBtn({ onClick, label, active }: { onClick?: () => void; label: string; active: boolean }) {
  return (
    <button
      onClick={active ? onClick : undefined}
      style={{ width: '100%', padding: '15px', borderRadius: 12, border: 'none', fontSize: 16, fontWeight: 700, cursor: active ? 'pointer' : 'default', fontFamily: 'Inter, sans-serif', background: active ? '#4b9fff' : '#1e1e1e', color: active ? '#fff' : '#3a3a3a', transition: 'background 0.15s' }}
    >
      {label}
    </button>
  )
}
