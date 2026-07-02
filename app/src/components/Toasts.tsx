import { useEffect, useRef, useState } from 'react'
import { useActivity } from '../realtime/hooks'
import type { Activity } from '../realtime/store'

/** Transient notifications for new launches, pushed from the activity stream. */
export function Toasts({ onOpen }: { onOpen: (symbol: string) => void }) {
  const activity = useActivity()
  const [toasts, setToasts] = useState<Activity[]>([])
  const seen = useRef<Set<number>>(new Set())
  const mounted = useRef(false)

  useEffect(() => {
    // ignore whatever's already in the feed on first mount
    if (!mounted.current) {
      mounted.current = true
      activity.forEach((a) => seen.current.add(a.id))
      return
    }
    const fresh = activity.filter((a) => a.kind === 'launch' && !seen.current.has(a.id))
    if (!fresh.length) return
    fresh.forEach((a) => seen.current.add(a.id))
    setToasts((t) => [...fresh, ...t].slice(0, 3))
    fresh.forEach((a) => setTimeout(() => setToasts((t) => t.filter((x) => x.id !== a.id)), 4500))
  }, [activity])

  if (!toasts.length) return null
  return (
    <div className="fixed left-1/2 top-20 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((a) => (
        <button
          key={a.id}
          onClick={() => onOpen(a.symbol)}
          className="rise-in flex cursor-pointer items-center gap-2.5 rounded-xl bg-surface px-4 py-3 text-left ring-1 ring-emerald/40 shadow-lg shadow-black/40 transition hover:ring-emerald"
        >
          <span className="text-[15px]">🚀</span>
          <span>
            <span className="block text-[13px] font-semibold text-ink">New coin launched</span>
            <span className="tnum block text-[12px] text-ink-2">{a.name} · ${a.symbol}</span>
          </span>
        </button>
      ))}
    </div>
  )
}
