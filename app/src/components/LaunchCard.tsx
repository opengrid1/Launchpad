import { compact, price, supplyOf, type Launch } from '../data/launches'
import { useLiveMarket } from './useLiveMarket'

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

const STATUS: Record<Launch['status'], { label: string; live?: boolean; cls: string }> = {
  live: { label: 'live', live: true, cls: 'text-emerald-strong' },
  upcoming: { label: 'soon', cls: 'text-gold' },
}

function CoinImage({ launch, ticker, className }: { launch: Launch; ticker: string; className: string }) {
  return (
    <div className={`relative shrink-0 overflow-hidden rounded-xl ${className}`} style={coinArt(ticker)}>
      {launch.image ? (
        <img src={launch.image} alt={launch.name} className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-[34px] drop-shadow-[0_2px_10px_rgba(0,0,0,0.35)]">
          {launch.glyph}
        </span>
      )}
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
  const s = STATUS[launch.status]
  const { price: live, changePct } = useLiveMarket(ticker, launch.priceEth, 24)
  const up = changePct >= 0
  const mcap = live * supplyOf(launch)
  const age = launch.startsIn ? `opens in ${launch.startsIn}` : launch.createdAgo

  return (
    <button
      onClick={onOpen}
      className={`rise-in group flex cursor-pointer gap-3 rounded-2xl bg-surface p-3 text-left ring-1 transition hover:ring-line-2 ${
        featured ? 'ring-gold/50 hover:ring-gold' : 'ring-line'
      }`}
      style={{ animationDelay: `${index * 30}ms` }}
    >
      <CoinImage launch={launch} ticker={ticker} className={featured ? 'h-28 w-28' : 'h-24 w-24'} />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-2">
          <h3 className={`truncate font-display font-bold leading-tight tracking-tight text-ink group-hover:text-emerald-strong ${featured ? 'text-[19px]' : 'text-[16px]'}`}>
            {launch.name} <span className="tnum text-[12px] font-medium text-ink-3">${ticker}</span>
          </h3>
          <span className={`inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold ${s.cls}`}>
            {s.live && <span className="h-1.5 w-1.5 rounded-full bg-emerald live-dot" />}
            {s.label}
          </span>
        </div>

        <p className="tnum mt-1 text-[11px] text-ink-3">
          by {launch.creator} · {age}
        </p>

        <p className="mt-1.5 text-[13px]">
          <span className="text-ink-3">mcap </span>
          <span className="tnum font-semibold text-emerald-strong">{compact(mcap)} ETH</span>
          <span className={`tnum ml-2 text-[12px] ${up ? 'text-emerald' : 'text-clay'}`}>
            {up ? '+' : ''}{changePct.toFixed(1)}%
          </span>
        </p>

        <p className={`mt-1.5 text-[12px] leading-snug text-ink-2 ${featured ? 'line-clamp-2' : 'line-clamp-2'}`}>
          {launch.tagline}
        </p>

        <p className="tnum mt-auto pt-1.5 text-[11px] text-ink-3">
          {price(live)} ETH · vol {compact(launch.volume)} · {launch.buyers.toLocaleString()} holders
        </p>
      </div>
    </button>
  )
}
