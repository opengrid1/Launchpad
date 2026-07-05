import type { Route } from '../App'
import type { Wallet } from '../web3/useWallet'

const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

function Search({ className, value, onChange }: { className: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className={`flex items-center gap-2 rounded-full bg-surface px-4 py-2 ring-1 ring-line focus-within:ring-line-2 ${className}`}>
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" className="shrink-0">
        <circle cx="7" cy="7" r="4.5" stroke="var(--color-ink-3)" strokeWidth="1.4" />
        <path d="M10.5 10.5 L14 14" stroke="var(--color-ink-3)" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search name, ticker, or address"
        className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
      />
      {value && (
        <button type="button" onClick={() => onChange('')} className="shrink-0 text-ink-3 transition hover:text-ink" aria-label="Clear">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
        </button>
      )}
    </label>
  )
}

export function Header({ route, onNavigate, wallet, query, onQuery }: { route: Route; onNavigate: (r: Route) => void; wallet: Wallet; query: string; onQuery: (v: string) => void }) {
  return (
    <header className="py-3">
      <div className="flex items-center gap-3">
        <button
          onClick={() => onNavigate({ page: 'explore' })}
          className="flex shrink-0 cursor-pointer items-center bg-transparent"
        >
          <span
            className="text-[21px] font-bold leading-none tracking-[-0.02em] text-ink"
            style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif" }}
          >
            Loxley
          </span>
        </button>

        {/* desktop search */}
        <Search className="ml-2 hidden flex-1 sm:flex md:max-w-md" value={query} onChange={onQuery} />

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <a
            href="https://x.com/Loxley_xyz"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Loxley on X"
            className="hidden h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-surface text-ink-2 ring-1 ring-line transition hover:text-ink hover:ring-line-2 sm:flex"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817-5.966 6.817H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
            </svg>
          </a>
          <button
            onClick={() => onNavigate({ page: 'create' })}
            className={`cursor-pointer rounded-full px-3 py-2 text-[13px] font-semibold transition sm:px-4 ${
              route.page === 'create' ? 'bg-emerald-strong text-paper' : 'bg-emerald text-paper hover:bg-emerald-strong'
            }`}
          >
            <span className="hidden sm:inline">Create coin</span>
            <span className="sm:hidden">Create</span>
          </button>
          <button
            onClick={() => wallet.connect()}
            className="flex cursor-pointer items-center gap-2 rounded-full bg-surface px-3.5 py-2 text-[13px] text-ink ring-1 ring-line transition hover:ring-line-2"
          >
            {wallet.account && <span className="h-2 w-2 shrink-0 rounded-full bg-emerald" />}
            <span className="tnum">{wallet.account ? shortAddr(wallet.account) : 'Connect wallet'}</span>
          </button>
        </div>
      </div>

      {/* mobile search row */}
      <Search className="mt-3 flex sm:hidden" value={query} onChange={onQuery} />
    </header>
  )
}
