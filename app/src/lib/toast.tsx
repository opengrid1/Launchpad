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

const KIND_STYLES: Record<Toast['kind'], string> = {
  success: 'ring-acc/40',
  error: 'ring-down/40',
  info: 'ring-hair2',
}

function ToastViewport({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div className="pointer-events-none fixed bottom-20 right-4 z-50 flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2 sm:bottom-4">
      {toasts.map((t) => (
        <div key={t.id} className={`pointer-events-auto rise-in rounded-xl bg-panel p-3.5 shadow-2xl ring-1 ${KIND_STYLES[t.kind]}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className={`text-sm font-bold ${t.kind === 'error' ? 'text-down' : t.kind === 'success' ? 'text-acc' : 'text-fg'}`}>
                {t.title}
              </p>
              {t.detail && <p className="mt-0.5 break-words text-xs leading-relaxed text-dim">{t.detail}</p>}
              {t.txHash && (
                <a
                  href={explorerTx(t.txHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block font-mono text-[11px] text-acc no-underline hover:text-accdeep"
                >
                  tx ↗
                </a>
              )}
            </div>
            <button onClick={() => dismiss(t.id)} className="cursor-pointer text-ghost hover:text-fg" aria-label="dismiss">
              ✕
            </button>
          </div>
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
