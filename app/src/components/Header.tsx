import type { Route } from '../App'

export function Header({ route, onNavigate }: { route: Route; onNavigate: (r: Route) => void }) {
  return (
    <header className="flex items-center justify-between border-b border-line py-4">
      <button
        onClick={() => onNavigate({ page: 'explore' })}
        className="flex cursor-pointer items-center gap-2.5 bg-transparent text-left"
      >
        {/* geometric mark — a plus in a hairline square, drawn 1px */}
        <span className="flex h-8 w-8 items-center justify-center border border-line-2">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 3 L8 13 M3 8 L13 8" stroke="var(--color-emerald)" strokeWidth="1" />
          </svg>
        </span>
        <span className="leading-none">
          <span className="font-pixel block text-[13px] tracking-tight text-ink">SHERWOOD</span>
          <span className="label mt-1 block">Robinhood · 4663</span>
        </span>
      </button>

      <nav className="hidden items-center gap-6 sm:flex">
        {(
          [
            ['Markets', 'explore'],
            ['Launch', 'create'],
          ] as const
        ).map(([label, page]) => (
          <button
            key={page}
            onClick={() => onNavigate({ page } as Route)}
            className={`cursor-pointer text-[13px] tracking-tight transition-colors ${
              route.page === page ? 'text-ink' : 'text-ink-3 hover:text-ink-2'
            }`}
          >
            <span className="text-ink-3">/</span>
            {label.toLowerCase()}
          </button>
        ))}
      </nav>

      <button className="flex cursor-pointer items-center gap-2.5 border border-line-2 px-3.5 py-2 text-[13px] text-ink transition-colors hover:border-emerald/50">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald live-dot" />
        <span className="tnum">0x71b3…9F02</span>
      </button>
    </header>
  )
}
