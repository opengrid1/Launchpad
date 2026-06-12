import { useState } from 'react'
import { useWallet } from '../lib/wallet'
import { shortAddress } from '../lib/format'

export type Page = 'board' | 'launch' | 'docs' | 'token'

export function Header({ page }: { page: Page }) {
  const { address, connecting, connect, disconnect, onCorrectChain, ensureChain, chainId } = useWallet()
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-5">
          <a href="#/" className="flex items-center gap-2 no-underline">
            {/* the logo is a flat line — the whole point */}
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M2 13 L16 13" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
                <path d="M2 8 Q7 8 9 5.5 T16 3" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" strokeDasharray="2 3" opacity="0.6" />
              </svg>
            </span>
            <span className="text-[17px] font-bold tracking-tight text-ink">Flatline</span>
          </a>

          <nav className="hidden items-center gap-0.5 sm:flex">
            {(
              [
                ['Board', 'board', '#/'],
                ['Docs', 'docs', '#/docs'],
              ] as const
            ).map(([label, key, href]) => (
              <a
                key={key}
                href={href}
                className={`rounded-full px-3 py-1.5 text-sm font-semibold no-underline transition-colors ${
                  page === key ? 'text-ink' : 'text-sub hover:text-ink'
                }`}
              >
                {label}
              </a>
            ))}
          </nav>
        </div>

        <div className="hidden items-center gap-2 sm:flex">
          {address && !onCorrectChain && chainId !== null && (
            <button
              onClick={() => void ensureChain()}
              className="cursor-pointer rounded-full bg-neg-soft px-3 py-2 text-xs font-bold text-neg transition hover:brightness-95"
            >
              Wrong network
            </button>
          )}
          <a
            href="#/launch"
            className="rounded-full bg-brand px-4 py-2 text-sm font-bold text-white no-underline transition hover:bg-brand-deep"
          >
            Launch
          </a>
          {!address ? (
            <button
              onClick={() => void connect()}
              disabled={connecting}
              className="cursor-pointer rounded-full bg-night px-4 py-2 text-sm font-bold text-white transition hover:bg-night-2 disabled:opacity-60"
            >
              {connecting ? 'Connecting…' : 'Connect wallet'}
            </button>
          ) : (
            <div className="relative">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="cursor-pointer rounded-full bg-card px-3.5 py-2 font-mono text-sm font-medium text-ink ring-1 ring-line transition hover:ring-line-strong"
              >
                {shortAddress(address)}
              </button>
              {menuOpen && (
                <div className="absolute right-0 z-20 mt-2 w-44 overflow-hidden rounded-2xl bg-card shadow-lg ring-1 ring-line">
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(address)
                      setMenuOpen(false)
                    }}
                    className="block w-full cursor-pointer px-4 py-2.5 text-left text-sm text-sub hover:bg-card-2 hover:text-ink"
                  >
                    Copy address
                  </button>
                  <button
                    onClick={() => {
                      disconnect()
                      setMenuOpen(false)
                    }}
                    className="block w-full cursor-pointer px-4 py-2.5 text-left text-sm text-neg hover:bg-card-2"
                  >
                    Disconnect
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
