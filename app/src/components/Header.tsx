import type { Route } from '../App'

export function Header({ route, onNavigate }: { route: Route; onNavigate: (r: Route) => void }) {
  return (
    <header className="flex items-center justify-between py-5">
      <button
        onClick={() => onNavigate({ page: 'explore' })}
        className="flex cursor-pointer items-center gap-2.5 bg-transparent text-left"
      >
        {/* logo — an arrow crossing a level line: the shot, and the split it makes */}
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-moss-500/15 ring-1 ring-moss-500/40">
          <svg width="19" height="19" viewBox="0 0 19 19" fill="none">
            <path d="M2 9.5 L17 9.5" stroke="var(--color-moss-400)" strokeWidth="1.7" strokeLinecap="round" />
            <path d="M12 4.5 L17 9.5 L12 14.5" stroke="var(--color-gold-400)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <path d="M4 6 Q6 9.5 4 13" stroke="var(--color-sage-500)" strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.8" />
          </svg>
        </span>
        <span>
          <span className="block font-display text-[19px] font-semibold leading-tight tracking-tight">Sherwood</span>
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-sage-500">launchpad · robinhood chain</span>
        </span>
      </button>

      <nav className="hidden items-center gap-1 rounded-full bg-pine-850/80 p-1 ring-1 ring-pine-700 sm:flex">
        {(
          [
            ['Explore', 'explore'],
            ['Launch', 'create'],
          ] as const
        ).map(([label, page]) => (
          <button
            key={page}
            onClick={() => onNavigate({ page } as Route)}
            className={`cursor-pointer rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              route.page === page ? 'bg-moss-500/15 text-moss-300' : 'text-sage-300 hover:text-parch-100'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="flex items-center gap-3">
        <span className="hidden items-center gap-1.5 font-mono text-xs text-sage-500 md:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-moss-400 live-dot" />
          Robinhood · 4663
        </span>
        <button className="cursor-pointer rounded-xl bg-moss-500 px-4 py-2 text-sm font-semibold text-pine-950 transition hover:bg-moss-400">
          0x71b3…9F02
        </button>
      </div>
    </header>
  )
}
