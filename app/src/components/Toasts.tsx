import { useEffect, useRef, useState } from 'react'
import { useActivity } from '../realtime/hooks'
import type { Activity } from '../realtime/store'

const KIND: Record<Activity['kind'], { label: string; cls: string }> = {
  launch: { label: 'Launched', cls: 'text-emerald-strong' },
  buy: { label: 'Buy', cls: 'text-emerald-strong' },
  sell: { label: 'Sell', cls: 'text-clay' },
  claim: { label: 'Claimed', cls: 'text-emerald-strong' },
}

/** Live notifications for every event (launch, buy, sell, claim), top-center. */
export function Toasts({ onOpen }: { onOpen: (symbol: string) => void }) {
  const activity = useActivity()
  const [toasts, setToasts] = useState<Activity[]>([])
  const seen = useRef<Set<number>>(new Set())
  const mounted = useRef(false)

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      activity.forEach((a) => seen.current.add(a.id))
      return
    }
    const fresh = activity.filter((a) => !seen.current.has(a.id))
    if (!fresh.length) return
    fresh.forEach((a) => seen.current.add(a.id))
    setToasts((t) => [...fresh, ...t].slice(0, 4))
    fresh.forEach((a) => setTimeout(() => setToasts((t) => t.filter((x) => x.id !== a.id)), 4500))
  }, [activity])

  if (!toasts.length) return null
  return (
    <div className="fixed left-1/2 top-20 z-[60] flex w-[min(92vw,340px)] -translate-x-1/2 flex-col items-stretch gap-2">
      {toasts.map((a) => {
        const k = KIND[a.kind]
        return (
          <div
            key={a.id}
            onClick={() => onOpen(a.symbol)}
            className="rise-in flex cursor-pointer items-center gap-3 rounded-xl bg-surface px-4 py-2.5 shadow-lg shadow-black/40 ring-1 ring-line transition hover:ring-line-2"
          >
            <span className={`shrink-0 text-[12px] font-semibold ${k.cls}`}>{k.label}</span>
            <span className="tnum min-w-0 flex-1 truncate text-[12px] text-ink">
              {a.name} <span className="text-ink-3">${a.symbol}</span>
              {a.amount ? <span className="text-ink-2"> · {a.amount}</span> : null}
            </span>
            <a
              href={a.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              title="View on Robinhood explorer"
              className="shrink-0 text-ink-3 transition hover:text-emerald-strong"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <path d="M6 3h7v7M13 3 7 9M11 9.5V13H3V5h3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          </div>
        )
      })}
    </div>
  )
}
