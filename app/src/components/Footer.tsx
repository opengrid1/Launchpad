export const LOXLEY_X = 'https://x.com/Loxley_xyz'

function XIcon({ className = '' }: { className?: string }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817-5.966 6.817H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
    </svg>
  )
}

export function Footer() {
  return (
    <footer className="mt-16 border-t border-line">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-5 py-6 sm:flex-row sm:px-8">
        <p className="text-[12px] text-ink-3">
          <span className="font-semibold text-ink-2" style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif" }}>
            Loxley
          </span>{' '}
          · Rob the trade. Pay the room.
        </p>
        <a
          href={LOXLEY_X}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-full bg-surface px-3.5 py-2 text-[12px] font-medium text-ink-2 ring-1 ring-line transition hover:text-ink hover:ring-line-2"
        >
          <XIcon />
          <span>@Loxley_xyz</span>
        </a>
      </div>
    </footer>
  )
}
