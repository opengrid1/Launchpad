/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { explorerTx } from './chain'

export type Toast = {
  id: number
  kind: 'success' | 'error' | 'info'
  title: string
  detail?: string
  txHash?: string
}

type ToastApi = {
  toasts: Toast[]
  push: (t: Omit<Toast, 'id'>) => void
  dismiss: (id: number) => void
}

const ToastContext = createContext<ToastApi | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id))
  }, [])

  const push = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = nextId.current++
      setToasts((list) => [...list.slice(-3), { ...t, id }])
      window.setTimeout(() => dismiss(id), t.kind === 'error' ? 9000 : 6000)
    },
    [dismiss],
  )

  const api = useMemo(() => ({ toasts, push, dismiss }), [toasts, push, dismiss])
  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} dismiss={dismiss} />
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast outside ToastProvider')
  return ctx
}

const KIND_RING: Record<Toast['kind'], string> = {
  success: 'ring-up/30',
  error: 'ring-down/30',
  info: 'ring-hair2',
}
const KIND_CHIP: Record<Toast['kind'], string> = {
  success: 'bg-upsoft text-up',
  error: 'bg-downsoft text-down',
  info: 'bg-accsoft text-acc',
}
const KIND_ICON: Record<Toast['kind'], ReactNode> = {
  success: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <path d="M3.5 8.5 L6.5 11.5 L12.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  error: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <path d="M4.5 4.5 L11.5 11.5 M11.5 4.5 L4.5 11.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  info: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <path d="M8 7.2 L8 11.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="8" cy="4.6" r="1.05" fill="currentColor" />
    </svg>
  ),
}

function ToastViewport({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div className="pointer-events-none fixed left-1/2 top-[4.5rem] z-[60] flex w-[min(400px,calc(100vw-1.5rem))] -translate-x-1/2 flex-col gap-2.5 sm:left-auto sm:right-4 sm:translate-x-0">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast-in pointer-events-auto flex items-start gap-3 rounded-xl border border-hair bg-panel/90 p-3.5 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.7)] ring-1 backdrop-blur-md ${KIND_RING[t.kind]}`}
        >
          <span className={`mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${KIND_CHIP[t.kind]}`}>
            {KIND_ICON[t.kind]}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-fg">{t.title}</p>
            {t.detail && <p className="mt-0.5 break-words text-xs leading-relaxed text-dim">{t.detail}</p>}
            {t.txHash && (
              <a
                href={explorerTx(t.txHash)}
                target="_blank"
                rel="noreferrer"
                className="mt-1.5 inline-flex items-center gap-1 font-mono text-[11px] text-acc no-underline hover:text-accdeep"
              >
                view transaction ↗
              </a>
            )}
          </div>
          <button
            onClick={() => dismiss(t.id)}
            className="-mr-1 -mt-1 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-ghost transition hover:bg-panel2 hover:text-fg"
            aria-label="dismiss"
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <path d="M3 3 L9 9 M9 3 L3 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  )
}

/** Trim noisy viem/wallet errors down to the most useful human part. */
export function errorMessage(err: unknown): string {
  if (typeof err === 'object' && err !== null) {
    const e = err as { shortMessage?: string; details?: string; message?: string; cause?: unknown }
    const cause = e.cause as { shortMessage?: string; details?: string; message?: string } | undefined
    const msg =
      cause?.details ||
      cause?.shortMessage ||
      e.details ||
      e.shortMessage ||
      cause?.message ||
      e.message ||
      String(err)
    return msg.length > 240 ? `${msg.slice(0, 240)}…` : msg
  }
  return String(err)
}
