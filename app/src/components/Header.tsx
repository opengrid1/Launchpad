import { useState } from 'react'
import { useWallet } from '../lib/wallet'
import { shortAddress } from '../lib/format'

export type Page = 'board' | 'launch' | 'token'

export function Header({ page }: { page: Page }) {
  const { address, connecting, connect, disconnect, onCorrectChain, ensureChain, chainId } = useWallet()
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <header className="flex items-center justify-between py-5">
      <a href="#/" className="flex items-center gap-2.5 text-left no-underline">
        {/* the logo is a flat line — the whole point */}
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-mint-500/15 ring-1 ring-mint-500/40">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M2 13 L16 13" stroke="var(--color-mint-400)" strokeWidth="2.4" strokeLinecap="round" />
            <path d="M2 8 Q7 8 9 5.5 T16 3" stroke="var(--color-fog-500)" strokeWidth="1.4" strokeLinecap="round" strokeDasharray="2 3" opacity="0.7" />
          </svg>
        </span>
        <span>
          <span className="block text-[17px] font-bold leading-tight tracking-tight text-fog-100">Flatline</span>
          <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-fog-500">HyperEVM launchpad</span>
        </span>
      </a>

      <nav className="hidden items-center gap-1 rounded-full bg-ink-850/80 p-1 ring-1 ring-ink-700 sm:flex">
        {(
          [
            ['Board', 'board', '#/'],
            ['Launch', 'launch', '#/launch'],
          ] as const
        ).map(([label, key, href]) => (
          <a
            key={key}
            href={href}
            className={`rounded-full px-4 py-1.5 text-sm font-medium no-underline transition-colors ${
              page === key ? 'bg-mint-500/15 text-mint-300' : 'text-fog-300 hover:text-fog-100'
            }`}
          >
            {label}
          </a>
        ))}
      </nav>

      <div className="flex items-center gap-3">
        {address && !onCorrectChain && chainId !== null && (
          <button
            onClick={() => void ensureChain()}
            className="cursor-pointer rounded-xl bg-amber-glow/15 px-3 py-2 text-xs font-semibold text-amber-glow ring-1 ring-amber-glow/40 transition hover:bg-amber-glow/25"
          >
            Switch to HyperEVM
          </button>
        )}
        {!address ? (
          <button
            onClick={() => void connect()}
            disabled={connecting}
            className="cursor-pointer rounded-xl bg-mint-500 px-4 py-2 text-sm font-semibold text-ink-950 transition hover:bg-mint-400 disabled:opacity-60"
          >
            {connecting ? 'Connecting…' : 'Connect wallet'}
          </button>
        ) : (
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="cursor-pointer rounded-xl bg-ink-850 px-4 py-2 font-mono text-sm font-medium text-fog-100 ring-1 ring-ink-700 transition hover:ring-mint-500/50"
            >
              {shortAddress(address)}
            </button>
            {menuOpen && (
              <div className="absolute right-0 z-20 mt-2 w-44 overflow-hidden rounded-xl bg-ink-850 ring-1 ring-ink-700">
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(address)
                    setMenuOpen(false)
                  }}
                  className="block w-full cursor-pointer px-4 py-2.5 text-left text-sm text-fog-300 hover:bg-ink-800 hover:text-fog-100"
                >
                  Copy address
                </button>
                <button
                  onClick={() => {
                    disconnect()
                    setMenuOpen(false)
                  }}
                  className="block w-full cursor-pointer px-4 py-2.5 text-left text-sm text-rose-soft hover:bg-ink-800"
                >
                  Disconnect
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  )
}
