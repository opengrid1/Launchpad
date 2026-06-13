import type { TokenMetadata } from '../lib/metadata'

const ICON: Record<'website' | 'twitter' | 'telegram', React.ReactNode> = {
  website: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.3" />
      <path d="M1.75 8h12.5M8 1.75c1.8 1.8 2.8 4 2.8 6.25S9.8 12.45 8 14.25c-1.8-1.8-2.8-4-2.8-6.25S6.2 3.55 8 1.75Z" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  ),
  twitter: (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M12.6 1.5h2.3l-5 5.72 5.9 7.78h-4.6l-3.6-4.71-4.13 4.71H1.06l5.37-6.13L0.8 1.5h4.7l3.26 4.31L12.6 1.5Zm-.8 12.1h1.27L4.27 2.83H2.9l8.9 10.77Z" />
    </svg>
  ),
  telegram: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M14.94 2.34 12.6 13.2c-.17.78-.64.97-1.29.6l-3.5-2.58-1.69 1.62c-.19.19-.34.35-.7.35l.25-3.57 6.49-5.86c.28-.25-.06-.39-.44-.14L3.49 8.78.07 7.71c-.74-.23-.76-.74.16-1.1L13.92 1.3c.62-.23 1.17.15.97 1.04Z" />
    </svg>
  ),
}

/**
 * Social links as icon buttons in a fixed order (website, X, telegram).
 * `compact` renders smaller, borderless icons for use inside dense rows.
 */
export function SocialIcons({ meta, compact, onClick }: { meta: TokenMetadata; compact?: boolean; onClick?: (e: React.MouseEvent) => void }) {
  const links = (
    [
      ['website', meta.website],
      ['twitter', meta.twitter],
      ['telegram', meta.telegram],
    ] as const
  ).filter((e): e is [keyof typeof ICON, string] => !!e[1])

  if (links.length === 0) return null
  return (
    <span className={compact ? 'inline-flex items-center gap-1' : 'flex items-center gap-1.5'}>
      {links.map(([kind, href]) => (
        <a
          key={kind}
          href={href.startsWith('http') ? href : `https://${href}`}
          target="_blank"
          rel="noreferrer"
          aria-label={kind}
          onClick={onClick}
          className={
            compact
              ? 'flex h-5 w-5 items-center justify-center rounded text-ghost transition hover:text-fg'
              : 'flex h-7 w-7 items-center justify-center rounded-lg text-ghost ring-1 ring-hair transition hover:text-fg hover:ring-hair2'
          }
        >
          {ICON[kind]}
        </a>
      ))}
    </span>
  )
}
