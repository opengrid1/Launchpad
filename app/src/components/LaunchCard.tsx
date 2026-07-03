import { defaultTokenImage, mcapUsd, usd, type Launch } from '../data/launches'
import { useMarket } from '../realtime/hooks'

/** Deterministic two-hue gradient from the ticker — stands in for coin art. */
function coinArt(symbol: string) {
  let h = 0
  for (const c of symbol) h = (h * 31 + c.charCodeAt(0)) >>> 0
  const h1 = h % 360
  const h2 = (h1 + 45) % 360
  return {
    backgroundImage: `radial-gradient(circle at 28% 22%, rgba(255,255,255,0.35), transparent 55%), linear-gradient(140deg, hsl(${h1} 68% 52%), hsl(${h2} 72% 42%))`,
  }
}

const ICONS: Record<string, React.ReactNode> = {
  x: <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" /></svg>,
  telegram: <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0Zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635Z" /></svg>,
  website: <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9.25" stroke="currentColor" strokeWidth="1.8" /><path d="M2.75 12h18.5M12 2.75c2.4 2.3 3.75 5.7 3.75 9.25S14.4 18.95 12 21.25c-2.4-2.3-3.75-5.7-3.75-9.25S9.6 5.05 12 2.75Z" stroke="currentColor" strokeWidth="1.8" /></svg>,
}

function CoinImage({ launch, ticker, className }: { launch: Launch; ticker: string; className: string }) {
  return (
    <div className={`relative shrink-0 overflow-hidden rounded-xl ${className}`} style={coinArt(ticker)}>
      <img
        src={launch.image || defaultTokenImage()}
        alt={launch.name}
        className="absolute inset-0 h-full w-full object-cover"
      />
    </div>
  )
}

/** pump.fun-style board card: image left, meta right, market cap in green. */
export function LaunchCard({
  launch,
  onOpen,
  index,
  featured = false,
}: {
  launch: Launch
  onOpen: () => void
  index: number
  featured?: boolean
}) {
  const ticker = launch.symbol.replace(/[^A-Za-z0-9]/g, '').slice(0, 5).toUpperCase()
  const { price: live, changePct } = useMarket(launch.id)
  const up = changePct >= 0
  const mcap = mcapUsd(live, launch)
  const socials = launch.socials
    ? (['x', 'telegram', 'website'] as const).map((k) => ({ k, href: launch.socials![k] })).filter((s) => s.href)
    : []

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen()}
      className={`rise-in group flex cursor-pointer gap-3 rounded-2xl bg-surface p-3 text-left ring-1 transition hover:ring-line-2 ${
        featured ? 'ring-gold/50 hover:ring-gold' : 'ring-line'
      }`}
      style={{ animationDelay: `${index * 30}ms` }}
    >
      <CoinImage launch={launch} ticker={ticker} className={featured ? 'h-28 w-28' : 'h-24 w-24'} />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className={`truncate font-display font-bold leading-tight tracking-tight text-ink group-hover:text-emerald-strong ${featured ? 'text-[19px]' : 'text-[16px]'}`}>
            {launch.name} <span className="tnum text-[12px] font-medium text-ink-3">${ticker}</span>
          </h3>
          <span className="tnum shrink-0 text-[11px] text-ink-3">{launch.createdAgo}</span>
        </div>

        <p className="mt-1.5 flex items-baseline gap-2">
          <span className="tnum text-[16px] font-semibold text-emerald-strong">{usd(mcap)}</span>
          <span className={`tnum text-[12px] ${up ? 'text-emerald' : 'text-clay'}`}>
            {up ? '+' : ''}{changePct.toFixed(1)}%
          </span>
        </p>

        <p className="mt-1 line-clamp-1 text-[12px] leading-snug text-ink-2">{launch.tagline}</p>

        {/* socials + contract + creator */}
        <div className="mt-auto flex items-center gap-2 pt-2">
          {socials.map((s) => (
            <a
              key={s.k}
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              aria-label={s.k}
              className="flex h-6 w-6 items-center justify-center rounded-md bg-panel text-ink-3 ring-1 ring-line transition hover:text-ink hover:ring-line-2"
            >
              {ICONS[s.k]}
            </a>
          ))}
          <span className="tnum ml-auto truncate text-[10px] text-ink-3">
            CA {launch.tokenAddress}
          </span>
        </div>
        <p className="tnum mt-1 truncate text-[10px] text-ink-3">by {launch.creator}</p>
      </div>
    </div>
  )
}
