import { LAUNCHPAD } from '../lib/contracts'
import { explorerAddress } from '../lib/chain'
import { SOCIALS } from '../lib/links'

const YEAR = new Date().getFullYear()

type Link = { label: string; href: string; external?: boolean }

const COLUMNS: ReadonlyArray<{ title: string; links: ReadonlyArray<Link> }> = [
  {
    title: 'Product',
    links: [
      { label: 'Launch a token', href: '#/launch' },
      { label: 'Markets', href: '#/' },
      { label: 'How it works', href: '#/docs' },
    ],
  },
  {
    title: 'Developers',
    links: [
      { label: 'Documentation', href: '#/docs' },
      { label: 'Whitepaper', href: '#/whitepaper' },
      { label: 'Contract', href: explorerAddress(LAUNCHPAD), external: true },
      { label: 'HyperEVMScan', href: 'https://hyperevmscan.io', external: true },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Terms of Service', href: '#/terms' },
      { label: 'Privacy Policy', href: '#/privacy' },
    ],
  },
]

const SOCIAL_ICONS: ReadonlyArray<{ label: string; href: string; icon: React.ReactNode }> = [
  {
    label: 'X',
    href: SOCIALS.twitter,
    icon: (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
        <path d="M12.6 1.5h2.3l-5 5.72 5.9 7.78h-4.6l-3.6-4.71-4.13 4.71H1.06l5.37-6.13L0.8 1.5h4.7l3.26 4.31L12.6 1.5Zm-.8 12.1h1.27L4.27 2.83H2.9l8.9 10.77Z" />
      </svg>
    ),
  },
  {
    label: 'Telegram',
    href: SOCIALS.telegram,
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
        <path d="M14.94 2.34 12.6 13.2c-.17.78-.64.97-1.29.6l-3.5-2.58-1.69 1.62c-.19.19-.34.35-.7.35l.25-3.57 6.49-5.86c.28-.25-.06-.39-.44-.14L3.49 8.78.07 7.71c-.74-.23-.76-.74.16-1.1L13.92 1.3c.62-.23 1.17.15.97 1.04Z" />
      </svg>
    ),
  },
  {
    label: 'Docs',
    href: SOCIALS.docs,
    icon: (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path
          d="M2.75 2.75h6.5l4 4v6.5a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1V3.75a1 1 0 0 1 1-1Z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <path d="M9 2.75V6.5h3.75M4.75 9.25h6.5M4.75 11.5h4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    ),
  },
]

export function Footer() {
  return (
    <footer className="mt-24 border-t border-hair pt-12">
      <div className="grid grid-cols-2 gap-8 sm:grid-cols-[1.4fr_1fr_1fr_1fr]">
        {/* brand */}
        <div className="col-span-2 sm:col-span-1">
          <a href="#/" className="flex items-center gap-2.5 no-underline">
            <span className="btn-primary flex h-8 w-8 items-center justify-center rounded-[10px]">
              <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
                <path d="M2 13 L16 13" stroke="#04201c" strokeWidth="2.6" strokeLinecap="round" />
                <path d="M2 8 Q7 8 9 5.5 T16 3" stroke="#04201c" strokeWidth="1.4" strokeLinecap="round" strokeDasharray="2 3" opacity="0.55" />
              </svg>
            </span>
            <span className="text-[15px] font-semibold tracking-tight text-fg">Hyprpad</span>
          </a>
          <p className="mt-3.5 max-w-[15rem] text-sm leading-relaxed text-ghost">
            Launch a live token market in one click on HyperEVM and keep 70% of every trade.
          </p>
          <div className="mt-5 flex items-center gap-2">
            {SOCIAL_ICONS.map((s) => (
              <a
                key={s.label}
                href={s.href}
                target={s.href.startsWith('#') ? undefined : '_blank'}
                rel="noreferrer"
                aria-label={s.label}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-ghost ring-1 ring-hair transition hover:text-acc hover:ring-acc/40"
              >
                {s.icon}
              </a>
            ))}
          </div>
        </div>

        {/* link columns */}
        {COLUMNS.map((col) => (
          <nav key={col.title} className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ghost">{col.title}</p>
            <ul className="mt-3.5 space-y-2.5">
              {col.links.map((l) => (
                <li key={l.label}>
                  <a
                    href={l.href}
                    target={l.external ? '_blank' : undefined}
                    rel={l.external ? 'noreferrer' : undefined}
                    className="text-sm text-dim no-underline transition-colors hover:text-fg"
                  >
                    {l.label}
                    {l.external && <span className="text-ghost"> ↗</span>}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      {/* bottom bar */}
      <div className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-hair py-6 font-mono text-[11px] text-ghost">
        <span>© {YEAR} Hyprpad. Unaudited reference implementation.</span>
        <span className="flex items-center gap-1.5">
          <span className="live-dot h-1.5 w-1.5 rounded-full bg-acc" />
          Live on HyperEVM
        </span>
      </div>
    </footer>
  )
}
