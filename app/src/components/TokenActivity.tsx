import { useEffect, useState } from 'react'
import { formatEther, type Address } from 'viem'
import { explorerTx, explorerAddress } from '../lib/chain'
import { fetchTrades, type Trade } from '../lib/gecko'
import { fetchHolders, type Holder, type TokenDetail } from '../lib/launchpad'
import { compactNumber, shortAddress, timeAgo } from '../lib/format'

type Tab = 'txns' | 'holders'

export function TokenActivity({ detail }: { detail: TokenDetail }) {
  const [tab, setTab] = useState<Tab>('txns')
  const [trades, setTrades] = useState<Trade[] | null>(null)
  const [holders, setHolders] = useState<Holder[] | null>(null)

  useEffect(() => {
    let alive = true
    const load = async () => {
      const t = await fetchTrades(detail.pool)
      if (!alive) return
      setTrades(t)
      const h = await fetchHolders(detail.token, detail.pool as Address, detail.creator as Address, t.map((x) => x.from))
      if (alive) setHolders(h)
    }
    void load()
    const id = window.setInterval(load, 20_000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [detail.pool, detail.token, detail.creator])

  const supply = Number(formatEther(detail.totalSupply))

  return (
    <section className="elev mt-5 overflow-hidden rounded-2xl ring-1 ring-hair">
      <div className="flex border-b border-hair">
        <Tab label="Transactions" active={tab === 'txns'} onClick={() => setTab('txns')} />
        <Tab label="Holders" active={tab === 'holders'} onClick={() => setTab('holders')} count={holders?.length} />
      </div>

      {tab === 'txns' ? (
        <Txns trades={trades} symbol={detail.symbol} />
      ) : (
        <Holders holders={holders} supply={supply} symbol={detail.symbol} creator={detail.creator} />
      )}
    </section>
  )
}

function Tab({ label, active, onClick, count }: { label: string; active: boolean; onClick: () => void; count?: number }) {
  return (
    <button
      onClick={onClick}
      className={`relative cursor-pointer px-4 py-3 text-sm font-semibold transition-colors ${active ? 'text-fg' : 'text-ghost hover:text-dim'}`}
    >
      {label}
      {count !== undefined && count > 0 && <span className="ml-1.5 font-mono text-xs text-ghost">{count}</span>}
      {active && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-acc" />}
    </button>
  )
}

function Txns({ trades, symbol }: { trades: Trade[] | null; symbol: string }) {
  if (trades === null) return <Loading />
  if (trades.length === 0) return <Empty text="No trades yet" />
  return (
    <div className="max-h-[420px] overflow-y-auto">
      <div className="grid grid-cols-[auto_1fr_1fr_auto] gap-3 border-b border-hair px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-ghost">
        <span>Type</span>
        <span className="text-right">Value</span>
        <span className="text-right">{symbol}</span>
        <span className="text-right">Time</span>
      </div>
      {trades.map((t, i) => (
        <a
          key={`${t.txHash}-${i}`}
          href={explorerTx(t.txHash)}
          target="_blank"
          rel="noreferrer"
          className={`grid grid-cols-[auto_1fr_1fr_auto] items-center gap-3 px-4 py-2.5 no-underline transition-colors hover:bg-panel2/60 ${i > 0 ? 'border-t border-hair' : ''}`}
        >
          <span className={`font-mono text-xs font-bold ${t.kind === 'buy' ? 'text-up' : 'text-down'}`}>{t.kind === 'buy' ? 'Buy' : 'Sell'}</span>
          <span className="text-right font-mono text-xs text-fg">${t.usd < 0.01 ? t.usd.toPrecision(2) : compactNumber(t.usd)}</span>
          <span className="text-right font-mono text-xs text-dim">{compactNumber(t.tokenAmount)}</span>
          <span className="text-right font-mono text-[11px] text-ghost">{t.ts ? timeAgo(t.ts) : '—'}</span>
        </a>
      ))}
    </div>
  )
}

function Holders({ holders, supply, symbol, creator }: { holders: Holder[] | null; supply: number; symbol: string; creator: string }) {
  if (holders === null) return <Loading />
  if (holders.length === 0) return <Empty text="No holders yet" />
  return (
    <div className="max-h-[420px] overflow-y-auto">
      <div className="grid grid-cols-[auto_1fr_auto_auto] gap-3 border-b border-hair px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-ghost">
        <span>#</span>
        <span>Wallet</span>
        <span className="text-right">{symbol}</span>
        <span className="text-right">%</span>
      </div>
      {holders.map((h, i) => {
        const bal = Number(formatEther(h.balance))
        const pct = supply > 0 ? (bal / supply) * 100 : 0
        const isCreator = h.address.toLowerCase() === creator.toLowerCase()
        return (
          <a
            key={h.address}
            href={explorerAddress(h.address)}
            target="_blank"
            rel="noreferrer"
            className={`grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 px-4 py-2.5 no-underline transition-colors hover:bg-panel2/60 ${i > 0 ? 'border-t border-hair' : ''}`}
          >
            <span className="font-mono text-xs text-ghost">{i + 1}</span>
            <span className="flex items-center gap-2 font-mono text-xs text-fg">
              {shortAddress(h.address)}
              {isCreator && <span className="rounded bg-accsoft px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-acc">dev</span>}
            </span>
            <span className="text-right font-mono text-xs text-dim">{compactNumber(bal)}</span>
            <span className="text-right font-mono text-xs text-fg">{pct < 0.01 ? '<0.01' : pct.toFixed(2)}%</span>
          </a>
        )
      })}
      <p className="px-4 py-3 font-mono text-[10px] leading-relaxed text-ghost">
        Active wallets (traders + dev). Liquidity pool excluded.
      </p>
    </div>
  )
}

function Loading() {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="shimmer h-7 rounded" />
      ))}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="px-4 py-12 text-center font-mono text-sm text-ghost">{text}</p>
}
