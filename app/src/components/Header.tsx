import type { Route } from '../App'

function Search({ className }: { className: string }) {
  return (
    <label className={`flex items-center gap-2 rounded-full bg-surface px-4 py-2 ring-1 ring-line focus-within:ring-line-2 ${className}`}>
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" className="shrink-0">
        <circle cx="7" cy="7" r="4.5" stroke="var(--color-ink-3)" strokeWidth="1.4" />
        <path d="M10.5 10.5 L14 14" stroke="var(--color-ink-3)" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      <input
        placeholder="Search coins"
        className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
      />
    </label>
  )
}

export function Header({ route, onNavigate }: { route: Route; onNavigate: (r: Route) => void }) {
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
        <Search className="ml-2 hidden flex-1 sm:flex md:max-w-md" />

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            onClick={() => onNavigate({ page: 'create' })}
            className={`cursor-pointer rounded-full px-3 py-2 text-[13px] font-semibold transition sm:px-4 ${
              route.page === 'create' ? 'bg-emerald-strong text-paper' : 'bg-emerald text-paper hover:bg-emerald-strong'
            }`}
          >
            <span className="hidden sm:inline">Create coin</span>
            <span className="sm:hidden">Create</span>
          </button>
          <button className="flex cursor-pointer items-center gap-2 rounded-full bg-surface px-3.5 py-2 text-[13px] text-ink ring-1 ring-line transition hover:ring-line-2">
            <span className="tnum">0x71b3…9F02</span>
          </button>
        </div>
      </div>

      {/* mobile search row */}
      <Search className="mt-3 flex sm:hidden" />
    </header>
  )
}
