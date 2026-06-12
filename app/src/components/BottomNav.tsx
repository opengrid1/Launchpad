import { useWallet } from '../lib/wallet'
import { shortAddress } from '../lib/format'
import type { Page } from './Header'

/** flaunch-style fixed bottom bar — the whole mobile shell lives here. */
export function BottomNav({ page }: { page: Page }) {
  const { address, connecting, connect, onCorrectChain, ensureChain, chainId } = useWallet()

  const focusSearch = () => {
    if (window.location.hash !== '#/' && window.location.hash !== '') {
      window.location.hash = '#/'
      window.setTimeout(() => document.getElementById('board-search')?.focus(), 250)
    } else {
      document.getElementById('board-search')?.focus()
    }
  }

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card/95 backdrop-blur-md sm:hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
        <a href="#/" aria-label="Board" className={`rounded-xl p-2.5 no-underline ${page === 'board' ? 'text-ink' : 'text-faint'}`}>
          <HomeIcon active={page === 'board'} />
        </a>
        <button onClick={focusSearch} aria-label="Search" className="cursor-pointer rounded-xl p-2.5 text-faint">
          <SearchIcon />
        </button>
        <a
          href="#/launch"
          aria-label="Launch a token"
          className={`flex h-10 w-10 items-center justify-center rounded-xl no-underline ${
            page === 'launch' ? 'bg-brand text-white' : 'bg-card-2 text-ink ring-1 ring-line'
          }`}
        >
          <span className="text-xl font-bold leading-none">+</span>
        </a>
        <a href="#/docs" aria-label="Docs" className={`rounded-xl p-2.5 no-underline ${page === 'docs' ? 'text-ink' : 'text-faint'}`}>
          <BookIcon active={page === 'docs'} />
        </a>
        {!address ? (
          <button
            onClick={() => void connect()}
            disabled={connecting}
            className="cursor-pointer rounded-full bg-night px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60"
          >
            {connecting ? '…' : 'Connect wallet'}
          </button>
        ) : !onCorrectChain && chainId !== null ? (
          <button onClick={() => void ensureChain()} className="cursor-pointer rounded-full bg-neg-soft px-4 py-2.5 text-xs font-bold text-neg">
            Wrong network
          </button>
        ) : (
          <span className="rounded-full bg-night px-4 py-2.5 font-mono text-xs font-bold text-white">{shortAddress(address)}</span>
        )}
      </div>
    </nav>
  )
}

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path
        d="M3.5 8.5 L10 3 L16.5 8.5 V16 a1 1 0 0 1 -1 1 H4.5 a1 1 0 0 1 -1 -1 Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
        fill={active ? 'currentColor' : 'none'}
        fillOpacity={active ? 0.15 : 0}
      />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M13.5 13.5 L17 17" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

function BookIcon({ active }: { active: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path
        d="M4 4.5 a1.5 1.5 0 0 1 1.5 -1.5 H16 v13 H5.5 A1.5 1.5 0 0 0 4 17.5 Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
        fill={active ? 'currentColor' : 'none'}
        fillOpacity={active ? 0.15 : 0}
      />
      <path d="M4 15.5 a1.5 1.5 0 0 1 1.5 -1.5 H16" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  )
}
