import { useState, useEffect } from 'react'
import {
  useAccount, useBalance, useWriteContract,
  useWaitForTransactionReceipt, useSwitchChain, useChainId,
} from 'wagmi'
import { useAppKit } from '@reown/appkit/react'
import { parseEther, formatEther } from 'viem'
import { mainnet } from './wagmiConfig'

const RH_CHAIN_ID = 4663
const BRIDGE_ADDRESS = '0x5dddea56774f01fc9d207bbd7b7633596a2f4a0b' as `0x${string}`
const LIQUIDITY    = 0
const MAX_PER_TX   = 0
const STATUS       = 'Paused'
const ACCENT       = '#CAFF00'

const CSS = `
  @keyframes spin { to { transform: rotate(360deg) } }
  @keyframes up   { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }
  * { box-sizing: border-box; margin: 0; padding: 0 }
  html, body { height: 100%; background: #0e0f0a; }
  input[type=number]::-webkit-outer-spin-button,
  input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none }
  input[type=number] { -moz-appearance: textfield }
  input:focus { outline: none }
`

function EthLogo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" style={{ borderRadius: '50%', background: '#627EEA', flexShrink: 0 }}>
      <path d="M16 5l-6.5 11.2L16 19.6l6.5-3.4z" fill="white" fillOpacity=".9"/>
      <path d="M16 19.6l-6.5-3.4L16 27l6.5-7.8z" fill="white" fillOpacity=".6"/>
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

  const balance  = balData ? +formatEther(balData.value) : null
  const parsed   = parseFloat(amount) || 0
  const receive  = parsed // 1:1 bridge
  const tooMuch  = balance != null && parsed > balance
  const canBridge = isConnected && onSrcChain && parsed > 0 && !tooMuch && step === 'idle' && STATUS !== 'Paused'

  const { writeContract: doBridge, data: bridgeTx } = useWriteContract()
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
      address: BRIDGE_ADDRESS,
      abi: [{ name: 'receive', type: 'receive', stateMutability: 'payable', inputs: [], outputs: [] }] as const,
      functionName: 'receive',
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
    if (!isConnected)        return 'Connect Wallet'
    if (!onSrcChain)         return switching ? 'Switching…' : `Switch to ${tab === 'deposit' ? 'Ethereum' : 'Robinhood Chain'}`
    if (step === 'done')     return 'Bridge Again'
    if (step === 'bridging') return 'Confirm in Wallet…'
    if (!parsed)             return 'Enter an Amount'
    if (tooMuch)             return 'Insufficient Balance'
    if (STATUS === 'Paused') return 'Bridge Paused'
    return tab === 'deposit'
      ? `Deposit ${parsed.toLocaleString('en', { maximumFractionDigits: 6 })} ETH`
      : `Withdraw ${parsed.toLocaleString('en', { maximumFractionDigits: 6 })} ETH`
  }

  const ctaEnabled = !step || step === 'idle' || step === 'done'
    ? (isConnected ? (onSrcChain ? (parsed > 0 && !tooMuch && STATUS !== 'Paused') : true) : true)
    : false

  const balFmt = balance != null
    ? balance.toLocaleString('en', { minimumFractionDigits: 4, maximumFractionDigits: 6 })
    : null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s: Record<string, any> = {
    page:    { minHeight: '100vh', background: '#0e0f0a', fontFamily: 'Inter, sans-serif', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 16px 80px' },
    wrap:    { width: '100%', maxWidth: 420 },
    card:    { background: '#161710', border: '1px solid #2a2c1e', borderRadius: 20, padding: 16, marginBottom: 12 },
    tabRow:  { display: 'flex', gap: 0, marginBottom: 20, background: '#0e0f0a', borderRadius: 12, padding: 4 },
    tabBtn:  (active: boolean) => ({
      flex: 1, padding: '10px 0', borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 600,
      fontSize: 14, fontFamily: 'Inter, sans-serif', transition: 'all .15s',
      background: active ? ACCENT : 'transparent',
      color: active ? '#0e0f0a' : '#888',
    }),
    fieldWrap: { background: '#0e0f0a', border: '1px solid #2a2c1e', borderRadius: 14, padding: '14px 16px', marginBottom: 8 },
    fieldLabel: { fontSize: 12, color: '#666', marginBottom: 6 },
    fieldRow:   { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
    amtInput:   { background: 'none', border: 'none', fontSize: 28, fontWeight: 600, color: '#fff', width: '100%', fontFamily: 'Inter, sans-serif' },
    amtDisplay: { fontSize: 28, fontWeight: 600, color: '#fff' },
    badge:      { background: '#1e2018', border: '1px solid #2a2c1e', borderRadius: 8, padding: '6px 12px', fontSize: 13, fontWeight: 600, color: '#fff', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 },
    arrow:      { display: 'flex', justifyContent: 'center', margin: '2px 0', position: 'relative' as const },
    arrowBtn:   { background: '#1e2018', border: '2px solid #0e0f0a', borderRadius: 8, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'default' },
    cta:        (enabled: boolean) => ({
      width: '100%', padding: '16px 0', borderRadius: 14, border: 'none', cursor: enabled ? 'pointer' : 'not-allowed',
      fontFamily: 'Inter, sans-serif', fontWeight: 700, fontSize: 16,
      background: enabled ? ACCENT : '#2a2c1e',
      color: enabled ? '#0e0f0a' : '#555',
      marginTop: 4, transition: 'all .15s',
    }),
    balRow:   { display: 'flex', justifyContent: 'flex-end', marginBottom: 8 },
    balText:  { fontSize: 12, color: '#666' },
    balVal:   { color: ACCENT, cursor: 'pointer', marginLeft: 4 },
    dotGreen: { width: 8, height: 8, borderRadius: '50%', background: ACCENT, flexShrink: 0 },
    dotRed:   { width: 8, height: 8, borderRadius: '50%', background: '#ff4444', flexShrink: 0 },
    liqNum:   { fontSize: 40, fontWeight: 700, color: '#fff', margin: '4px 0 0' },
    liqSub:   { fontSize: 13, color: '#666', marginTop: 2 },
    infoRow:  { display: 'flex', justifyContent: 'space-between', marginTop: 16, paddingTop: 16, borderTop: '1px solid #2a2c1e' },
    infoLabel:{ fontSize: 13, color: '#888' },
    infoVal:  (red?: boolean) => ({ fontSize: 13, fontWeight: 600, color: red ? '#ff4444' : '#fff' }),
    stepNum:  { width: 24, height: 24, borderRadius: '50%', background: '#1e2018', border: `1px solid #2a2c1e`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: ACCENT, flexShrink: 0 },
    footer:   { marginTop: 32, textAlign: 'center' as const, fontSize: 12, color: '#444', lineHeight: 1.6 },
  }

  return (
    <>
      <style>{CSS}</style>
      <div style={s.page}>
        <div style={s.wrap}>

          {/* Tab switcher */}
          <div style={s.card}>
            <div style={s.tabRow}>
              <button style={s.tabBtn(tab === 'deposit')}  onClick={() => setTab('deposit')}>Deposit → RH</button>
              <button style={s.tabBtn(tab === 'withdraw')} onClick={() => setTab('withdraw')}>Withdraw → ETH</button>
            </div>

            {/* FROM field */}
            <div style={s.fieldWrap}>
              <div style={s.fieldLabel}>{tab === 'deposit' ? 'From Ethereum' : 'From Robinhood Chain'}</div>
              <div style={s.fieldRow}>
                <input
                  type="number"
                  placeholder="0.0"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  style={s.amtInput}
                />
                <div style={s.badge}>
                  <EthLogo size={18} />
                  ETH
                </div>
              </div>
            </div>

            {/* Arrow */}
            <div style={s.arrow}>
              <div style={s.arrowBtn}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M7 2v10M3 8l4 4 4-4" stroke={ACCENT} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            </div>

            {/* TO field */}
            <div style={{ ...s.fieldWrap, marginBottom: 16 }}>
              <div style={s.fieldLabel}>{tab === 'deposit' ? 'To Robinhood Chain (you receive)' : 'To Ethereum (you receive)'}</div>
              <div style={s.fieldRow}>
                <div style={s.amtDisplay}>{receive > 0 ? receive.toLocaleString('en', { maximumFractionDigits: 6 }) : '0.0'}</div>
                <div style={s.badge}>
                  <EthLogo size={18} />
                  ETH
                </div>
              </div>
            </div>

            {/* Balance */}
            {isConnected && balFmt && (
              <div style={s.balRow}>
                <span style={s.balText}>
                  Balance: <span style={s.balVal} onClick={() => setAmount(balance?.toFixed(6) ?? '')}>{balFmt} ETH</span>
                </span>
              </div>
            )}

            {/* CTA */}
            <button style={s.cta(ctaEnabled)} onClick={handleCta} disabled={!ctaEnabled}>
              {step === 'bridging'
                ? <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                    <span style={{ width: 16, height: 16, border: `2px solid #0e0f0a`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite', display: 'inline-block' }}/>
                    {ctaLabel()}
                  </span>
                : ctaLabel()
              }
            </button>
          </div>

          {/* Liquidity card */}
          <div style={s.card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={STATUS === 'Paused' ? s.dotRed : s.dotGreen} />
              <span style={{ fontSize: 13, fontWeight: 600, color: ACCENT }}>Available Bridge Liquidity</span>
            </div>
            <div style={s.liqNum}>{LIQUIDITY} <span style={{ fontSize: 24, color: ACCENT }}>ETH</span></div>
            <div style={s.liqSub}>on Robinhood Chain</div>
            <div style={s.infoRow}>
              <div>
                <div style={s.infoLabel}>Max per bridge</div>
                <div style={s.infoVal()}>{MAX_PER_TX} ETH</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={s.infoLabel}>Status</div>
                <div style={s.infoVal(STATUS === 'Paused')}>{STATUS}</div>
              </div>
            </div>
          </div>

          {/* How it works */}
          <div style={s.card}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>How it works</div>
            {[
              'Enter the amount of ETH to bridge.',
              'A liquidity solver delivers ETH on the other side.',
              'Funds arrive in seconds — no 7-day wait.',
            ].map((text, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: i < 2 ? 12 : 0 }}>
                <div style={s.stepNum}>{i + 1}</div>
                <div style={{ fontSize: 13, color: '#aaa', lineHeight: 1.5, paddingTop: 3 }}>{text}</div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div style={s.footer}>
            Routing via the Relay Protocol on Ethereum &amp; Robinhood Chain (4663).
            <br />
            <span style={{ color: '#333', marginTop: 6, display: 'block' }}>rhbridge.xyz</span>
          </div>

        </div>
      </div>
    </>
  )
}
