import type { Route } from '../App'

export function Header({ route, onNavigate }: { route: Route; onNavigate: (r: Route) => void }) {
  return (
    <header className="flex items-center justify-between py-6">
      <button
        onClick={() => onNavigate({ page: 'explore' })}
        className="flex cursor-pointer items-baseline gap-2.5 bg-transparent text-left"
      >
        {/* a leaf, drawn once — the concept, not a logo generator */}
        <svg width="16" height="18" viewBox="0 0 20 22" fill="none" className="translate-y-0.5">
          <path d="M10 2 C6 7 6 14 10 20 C14 14 14 7 10 2 Z" fill="none" stroke="var(--color-emerald)" strokeWidth="1.4" />
          <path d="M10 3 L10 19" stroke="var(--color-emerald)" strokeWidth="1.1" />
        </svg>
        <span className="font-display text-[21px] font-medium leading-none tracking-tight text-ink">Sherwood</span>
      </button>

      <nav className="hidden items-center gap-7 sm:flex">
        {(
          [
            ['Launches', 'explore'],
            ['Start one', 'create'],
          ] as const
        ).map(([label, page]) => (
          <button
            key={page}
            onClick={() => onNavigate({ page } as Route)}
            className={`cursor-pointer text-[14px] transition-colors ${
              route.page === page ? 'text-ink' : 'text-ink-2 hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      <button className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-2 transition-colors hover:text-ink">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald live-dot" />
        <span className="tnum">0x71b3…9F02</span>
      </button>
    </header>
  )
}
