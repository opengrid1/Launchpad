import { useState } from 'react'
import { useWallet } from '../lib/wallet'
import { shortAddress } from '../lib/format'

export type Page = 'board' | 'launch' | 'docs' | 'token'

const NAV: ReadonlyArray<readonly [string, Page, string]> = [
  ['Home', 'board', '#/'],
  ['Launch', 'launch', '#/launch'],
  ['Docs', 'docs', '#/docs'],
]

export function Header({ page }: { page: Page }) {
  const { address, connecting, connect, disconnect, onCorrectChain, ensureChain, chainId } = useWallet()
  const [menuOpen, setMenuOpen] = useState(false)
  const [navOpen, setNavOpen] = useState(false)

  return (
    <header className="sticky top-0 z-40 border-b border-hair bg-base/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
        <div className="flex items-center gap-3">
          {/* hamburger (mobile) */}
          <button
            onClick={() => setNavOpen((v) => !v)}
            aria-label="Menu"
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-fg ring-1 ring-hair transition hover:bg-panel2 sm:hidden"
          >
            <svg width="17" height="17" viewBox="0 0 18 18" fill="none">
              <path d="M2.5 5h13M2.5 9h13M2.5 13h13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>

          <a href="#/" className="flex items-center gap-2.5 no-underline">
            <span className="btn-primary flex h-8 w-8 items-center justify-center rounded-[10px]">
              <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
                <path d="M2 13 L16 13" stroke="#04201c" strokeWidth="2.6" strokeLinecap="round" />
                <path d="M2 8 Q7 8 9 5.5 T16 3" stroke="#04201c" strokeWidth="1.4" strokeLinecap="round" strokeDasharray="2 3" opacity="0.55" />
              </svg>
            </span>
            <span className="text-[15px] font-semibold tracking-tight text-fg">Flatline</span>
          </a>

          <nav className="hidden items-center gap-1 sm:flex">
            {NAV.map(([label, key, href]) => (
              <a
                key={key}
                href={href}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium no-underline transition-colors ${
                  page === key ? 'text-fg' : 'text-ghost hover:text-dim'
                }`}
              >
                {label}
              </a>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          {address && !onCorrectChain && chainId !== null && (
            <button
              onClick={() => void ensureChain()}
              className="cursor-pointer rounded-lg bg-downsoft px-3 py-2 text-xs font-bold text-down transition hover:brightness-110"
            >
              Wrong network
            </button>
          )}
          {!address ? (
            <button
              onClick={() => connect()}
              disabled={connecting}
              className="btn-primary cursor-pointer rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60"
            >
              {connecting ? '…' : 'Connect'}
            </button>
          ) : (
            <div className="relative">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="cursor-pointer rounded-lg px-3.5 py-2 font-mono text-sm text-fg ring-1 ring-hair2 transition hover:bg-panel2"
              >
                {shortAddress(address)}
              </button>
              {menuOpen && (
                <div className="absolute right-0 z-20 mt-2 w-44 overflow-hidden rounded-xl bg-panel shadow-xl ring-1 ring-hair2">
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(address)
                      setMenuOpen(false)
                    }}
                    className="block w-full cursor-pointer px-4 py-2.5 text-left text-sm text-dim hover:bg-panel2 hover:text-fg"
                  >
                    Copy address
                  </button>
                  <button
                    onClick={() => {
                      disconnect()
                      setMenuOpen(false)
                    }}
                    className="block w-full cursor-pointer px-4 py-2.5 text-left text-sm text-down hover:bg-panel2"
                  >
                    Disconnect
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* mobile nav drawer */}
      {navOpen && (
        <nav className="border-t border-hair bg-base/95 px-4 py-2 sm:hidden">
          {NAV.map(([label, key, href]) => (
            <a
              key={key}
              href={href}
              onClick={() => setNavOpen(false)}
              className={`block rounded-lg px-3 py-2.5 text-sm font-medium no-underline transition-colors ${
                page === key ? 'bg-panel2 text-acc' : 'text-dim hover:bg-panel2 hover:text-fg'
              }`}
            >
              {label}
            </a>
          ))}
        </nav>
      )}
    </header>
  )
}
