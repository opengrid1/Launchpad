import type { Page } from '../App'

const NAV: [string, Page][] = [
  ['Deposit', 'deposit'],
  ['Withdraw', 'withdraw'],
  ['Pool', 'pool'],
  ['About', 'about'],
]

export function Header({ page, onNavigate }: { page: Page; onNavigate: (p: Page) => void }) {
  return (
    <header className="flex items-center justify-between py-5">
      <button
        onClick={() => onNavigate('deposit')}
        className="flex cursor-pointer items-center gap-2.5 bg-transparent text-left"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-iris-500/15 ring-1 ring-iris-500/40">
          {/* a circle behind a veil — what crosses the line is hidden */}
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <circle cx="9" cy="9" r="4.6" stroke="var(--color-iris-400)" strokeWidth="1.6" />
            <path d="M2.5 9 H15.5" stroke="var(--color-void-900)" strokeWidth="3" />
            <path d="M2.5 9 H15.5" stroke="var(--color-iris-300)" strokeWidth="1.2" strokeDasharray="1.5 2.5" opacity="0.8" />
          </svg>
        </span>
        <span>
          <span className="block text-[17px] font-bold leading-tight tracking-tight">Veil</span>
          <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-fog-500">private transfers</span>
        </span>
      </button>

      <nav className="hidden items-center gap-1 rounded-full bg-void-850/80 p-1 ring-1 ring-void-700 sm:flex">
        {NAV.map(([label, p]) => (
          <button
            key={p}
            onClick={() => onNavigate(p)}
            className={`cursor-pointer rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              page === p ? 'bg-iris-500/15 text-iris-300' : 'text-fog-300 hover:text-fog-100'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="flex items-center gap-3">
        <span className="hidden items-center gap-1.5 font-mono text-xs text-fog-500 md:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-mint-400 live-dot" />
          HyperEVM · 999
        </span>
        <button className="cursor-pointer rounded-xl bg-iris-500 px-4 py-2 text-sm font-semibold text-void-950 transition hover:bg-iris-400">
          0x3fA8…c21D
        </button>
      </div>
    </header>
  )
}
