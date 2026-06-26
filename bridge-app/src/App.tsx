import { useState } from 'react'
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
  const [amount, setAmount] = useState('1000.00')
  const [phase, setPhase]   = useState<'idle'|'bridging'|'relaying'|'done'>('idle')
  const [txHash, setTxHash] = useState<string | null>(null)

  const { address, isConnected } = useAccount()
  const { connect }    = useConnect()
  const { disconnect } = useDisconnect()
  const chainId        = useChainId()
  const { switchChain, isPending: switching } = useSwitchChain()

  const { data: usdcRaw } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_BALANCE_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: mainnet.id,
    query: { enabled: !!address },
  })

  const usdcBalance = usdcRaw != null ? +formatUnits(usdcRaw as bigint, 6) : null
  const balDisplay  = usdcBalance != null ? usdcBalance.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'

  const parsed    = parseFloat(amount) || 0
  const onMainnet = chainId === mainnet.id
  const tooMuch   = usdcBalance != null && parsed > usdcBalance
  const canBridge = isConnected && onMainnet && parsed > 0 && !tooMuch && phase === 'idle'

  function startBridge() {
    if (!canBridge) return
    setPhase('bridging')
    const hash = '0x' + Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, '0')).join('')
    setTimeout(() => { setTxHash(hash); setPhase('relaying') }, 1600)
    setTimeout(() => setPhase('done'), 5000)
  }

  function reset() { setPhase('idle'); setTxHash(null) }

  const steps = ['Submitting to Circle CCTP', 'Relay in progress', 'Minted on Arc']
  const phaseIdx = ['bridging', 'relaying', 'done'].indexOf(phase)

  return (
    <div style={{ minHeight: '100vh', background: '#080810', fontFamily: "'Inter', system-ui, sans-serif", WebkitFontSmoothing: 'antialiased' }}>

      {/* Background ambient */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0 }}>
        <div style={{ position: 'absolute', top: '-15%', left: '50%', transform: 'translateX(-50%)', width: 700, height: 400, background: 'radial-gradient(ellipse, rgba(99,102,241,0.08) 0%, transparent 70%)', borderRadius: '50%' }} />
      </div>

      {/* Nav */}
      <nav style={{ position: 'relative', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 40px', height: 68, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 1l5 9H2L7 1z" fill="white" fillOpacity=".9"/>
            </svg>
          </div>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#fff', letterSpacing: '-0.4px' }}>ArcBridge</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '4px' }}>
          {['Bridge', 'History'].map(item => (
            <button key={item} style={{ padding: '6px 14px', borderRadius: 7, border: 'none', background: item === 'Bridge' ? 'rgba(255,255,255,0.08)' : 'transparent', color: item === 'Bridge' ? '#fff' : 'rgba(255,255,255,0.4)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              {item}
            </button>
          ))}
        </div>

        <button
          onClick={isConnected ? () => disconnect() : () => connect({ connector: injected() })}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', background: isConnected ? 'rgba(255,255,255,0.05)' : 'rgba(99,102,241,0.15)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s' }}
        >
          {isConnected && <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#22d3ee' }} />}
          {isConnected ? `${address?.slice(0, 6)}…${address?.slice(-4)}` : 'Connect Wallet'}
        </button>
      </nav>

      {/* Main */}
      <main style={{ position: 'relative', zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '72px 16px 80px' }}>

        {/* Heading */}
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '5px 12px', borderRadius: 100, border: '1px solid rgba(99,102,241,0.3)', background: 'rgba(99,102,241,0.08)', marginBottom: 20 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#6366f1' }} />
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', color: '#818cf8', textTransform: 'uppercase' }}>Powered by Circle CCTP</span>
          </div>
          <h1 style={{ fontSize: 'clamp(36px, 6vw, 60px)', fontWeight: 800, color: '#fff', letterSpacing: '-2px', lineHeight: 1.05, margin: '0 0 14px' }}>
            Bridge to Arc Network
          </h1>
          <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.35)', maxWidth: 400, margin: '0 auto', lineHeight: 1.6 }}>
            Transfer USDC from Ethereum with sub-second finality and zero slippage.
          </p>
        </div>

        {/* Card */}
        <div style={{ width: '100%', maxWidth: 480 }}>
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 24, padding: 24, backdropFilter: 'blur(12px)' }}>

            {/* FROM block */}
            <div style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, padding: '0 2px' }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase' }}>From</span>
                {isConnected && (
                  <button
                    onClick={() => usdcBalance != null && setAmount(usdcBalance.toFixed(2))}
                    style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 5 }}
                  >
                    Balance:
                    <span style={{ color: tooMuch ? '#f87171' : 'rgba(255,255,255,0.55)', fontWeight: 600 }}>{balDisplay} USDC</span>
                    <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.3)', fontWeight: 700 }}>MAX</span>
                  </button>
                )}
              </div>

              <div style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${tooMuch ? 'rgba(248,113,113,0.3)' : 'rgba(255,255,255,0.07)'}`, borderRadius: 16, padding: '16px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', transition: 'border-color 0.15s' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <img src="https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png"
                    width={36} height={36} style={{ borderRadius: '50%', objectFit: 'cover' }} alt="Ethereum" />
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', lineHeight: 1 }}>Ethereum</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginTop: 3 }}>Mainnet</div>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <input
                    type="number"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    style={{ background: 'transparent', border: 'none', outline: 'none', fontSize: 24, fontWeight: 700, color: tooMuch ? '#f87171' : '#fff', textAlign: 'right', width: 150, fontFamily: 'inherit' }}
                  />
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginTop: 2, fontWeight: 600, letterSpacing: '0.05em' }}>USDC</div>
                </div>
              </div>
            </div>

            {/* Swap arrow */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 36, position: 'relative' }}>
              <div style={{ position: 'absolute', left: 0, right: 0, height: 1, background: 'rgba(255,255,255,0.05)' }} />
              <div style={{ position: 'relative', zIndex: 1, width: 32, height: 32, borderRadius: '50%', background: '#0e0e18', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M6 1.5v9M2.5 7.5L6 11l3.5-3.5" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            </div>

            {/* TO block */}
            <div style={{ marginTop: 8, marginBottom: 20 }}>
              <div style={{ marginBottom: 10, padding: '0 2px' }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase' }}>To</span>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 16, padding: '16px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <img src="/logo-1.png" width={36} height={36}
                    style={{ borderRadius: 10, objectFit: 'cover' }} alt="Arc Network" />
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', lineHeight: 1 }}>Arc Network</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginTop: 3 }}>Chain ID 5042</div>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 24, fontWeight: 700, color: parsed > 0 ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.15)' }}>
                    {parsed > 0 ? parsed.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginTop: 2, fontWeight: 600, letterSpacing: '0.05em' }}>USDC</div>
                </div>
              </div>
            </div>

            {/* Details */}
            <div style={{ borderRadius: 14, border: '1px solid rgba(255,255,255,0.05)', overflow: 'hidden', marginBottom: 16 }}>
              {[
                { label: 'Network fee',       value: '0.00 USDC',    accent: '#34d399' },
                { label: 'Circle minter cap', value: '— USDC',       accent: 'rgba(255,255,255,0.35)' },
                { label: 'Estimated time',    value: '~15 min',      accent: 'rgba(255,255,255,0.35)' },
                { label: 'Router',            value: 'Circle CCTP',  accent: '#818cf8' },
              ].map((row, i, arr) => (
                <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 16px', borderBottom: i < arr.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none', background: i % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'transparent' }}>
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', fontWeight: 500 }}>{row.label}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: row.accent, fontVariantNumeric: 'tabular-nums' }}>{row.value}</span>
                </div>
              ))}
            </div>

            {/* Progress */}
            {phase !== 'idle' && (
              <div style={{ borderRadius: 14, border: '1px solid rgba(255,255,255,0.07)', padding: '16px', marginBottom: 16, background: 'rgba(255,255,255,0.02)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: phase === 'done' ? '#34d399' : '#fff' }}>
                    {phase === 'done' ? '✓ Transfer complete' : 'Bridging USDC…'}
                  </span>
                  {phase === 'done' && (
                    <button onClick={reset} style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                      New transfer
                    </button>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {steps.map((label, i) => {
                    const done   = phaseIdx > i
                    const active = phaseIdx === i
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, border: `1.5px solid ${done ? '#34d399' : active ? '#6366f1' : 'rgba(255,255,255,0.1)'}`, background: done ? '#34d399' : active ? 'rgba(99,102,241,0.2)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}>
                          {done && <svg width="9" height="7" viewBox="0 0 9 7" fill="none"><path d="M1 3.5l2.5 2.5L8 1" stroke="#080810" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                          {active && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#6366f1' }} />}
                        </div>
                        <span style={{ fontSize: 13, color: done ? 'rgba(255,255,255,0.25)' : active ? '#fff' : 'rgba(255,255,255,0.15)', fontWeight: active ? 600 : 400 }}>{label}</span>
                        {active && <div style={{ marginLeft: 'auto', width: 14, height: 14, border: '2px solid rgba(99,102,241,0.5)', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />}
                      </div>
                    )
                  })}
                </div>
                {txHash && (
                  <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', fontFamily: 'JetBrains Mono, monospace' }}>{txHash.slice(0, 22)}…</span>
                    <a href={`https://explorer.arc.io/tx/${txHash}`} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#818cf8', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                      View tx
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 8L8 2M4.5 2H8v3.5" stroke="#818cf8" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </a>
                  </div>
                )}
              </div>
            )}

            {/* CTA */}
            {!isConnected ? (
              <BridgeBtn onClick={() => connect({ connector: injected() })} label="Connect Wallet" state="active" />
            ) : !onMainnet ? (
              <BridgeBtn onClick={() => switchChain({ chainId: mainnet.id })} label={switching ? 'Switching…' : 'Switch to Ethereum'} state={switching ? 'loading' : 'active'} />
            ) : phase !== 'idle' ? (
              <BridgeBtn label={phase === 'done' ? 'Complete' : 'Bridging…'} state="loading" />
            ) : (
              <BridgeBtn onClick={startBridge} label="Bridge USDC" state={canBridge ? 'active' : 'disabled'} />
            )}
          </div>

          {/* Footer note */}
          <p style={{ textAlign: 'center', fontSize: 12, color: 'rgba(255,255,255,0.18)', marginTop: 20, lineHeight: 1.6 }}>
            Secured by{' '}
            <a href="https://www.circle.com/cctp" target="_blank" rel="noreferrer" style={{ color: 'rgba(255,255,255,0.35)', textDecoration: 'underline', textDecorationColor: 'rgba(255,255,255,0.15)' }}>
              Circle CCTP
            </a>
            {' '}· No custodial risk
          </p>
        </div>
      </main>
    </div>
  )
}

function BridgeBtn({ onClick, label, state }: { onClick?: () => void; label: string; state: 'active' | 'disabled' | 'loading' }) {
  const isActive = state === 'active'
  return (
    <button
      onClick={isActive ? onClick : undefined}
      style={{
        width: '100%',
        padding: '15px',
        borderRadius: 14,
        border: 'none',
        fontSize: 15,
        fontWeight: 700,
        cursor: isActive ? 'pointer' : 'default',
        fontFamily: 'inherit',
        letterSpacing: '-0.2px',
        background: isActive
          ? 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)'
          : 'rgba(255,255,255,0.04)',
        color: isActive ? '#fff' : 'rgba(255,255,255,0.2)',
        boxShadow: isActive ? '0 4px 24px rgba(99,102,241,0.35)' : 'none',
        transition: 'all 0.15s',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
      }}
    >
      {state === 'loading' && (
        <div style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      )}
      {label}
    </button>
  )
}
