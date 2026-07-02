import type { Route } from '../App'

export function Header({ route, onNavigate }: { route: Route; onNavigate: (r: Route) => void }) {
  return (
    <header className="flex items-center justify-between border-b border-line py-5">
      <button
        onClick={() => onNavigate({ page: 'explore' })}
        className="flex cursor-pointer items-center gap-3 bg-transparent text-left"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-ink">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M3 9 L15 9" stroke="var(--color-paper)" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M9 3 L9 15" stroke="var(--color-paper)" strokeWidth="1.6" strokeLinecap="round" opacity="0.5" />
            <circle cx="9" cy="9" r="2.4" fill="none" stroke="var(--color-paper)" strokeWidth="1.6" />
          </svg>
        </span>
        <span>
          <span className="block font-display text-[18px] font-semibold leading-none tracking-tight">Sherwood</span>
          <span className="mt-1 block text-[11px] font-medium tracking-tight text-ink-3">Launchpad · Robinhood Chain</span>
        </span>
      </button>

      <nav className="hidden items-center gap-6 sm:flex">
        {(
          [
            ['Explore', 'explore'],
            ['Launch', 'create'],
          ] as const
        ).map(([label, page]) => (
          <button
            key={page}
            onClick={() => onNavigate({ page } as Route)}
            className={`cursor-pointer text-sm font-medium transition-colors ${
              route.page === page ? 'text-ink' : 'text-ink-3 hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="flex items-center gap-4">
        <span className="hidden items-center gap-2 text-xs font-medium text-ink-3 md:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald live-dot" />
          Robinhood · 4663
        </span>
        <button className="tnum cursor-pointer rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink transition hover:border-line-2">
          0x71b3…9F02
        </button>
      </div>
    </header>
  )
}
