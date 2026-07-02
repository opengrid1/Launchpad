import { compact, hardCapOf, price, type Launch } from '../data/launches'

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
  live: { label: 'Live', live: true, cls: 'text-paper bg-emerald' },
  upcoming: { label: 'Soon', cls: 'text-gold bg-gold-tint' },
  graduated: { label: 'Graduated', cls: 'text-ink bg-panel' },
  refunding: { label: 'Refunding', cls: 'text-clay bg-clay-tint' },
}

export function LaunchCard({ launch, onOpen, index }: { launch: Launch; onOpen: () => void; index: number }) {
  const hardCap = hardCapOf(launch)
  const pct = Math.min(100, (launch.raised / hardCap) * 100)
  const ticker = launch.symbol.replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase()
  const s = STATUS[launch.status]
  const age = launch.startsIn ? `opens ${launch.startsIn}` : launch.endsIn ? `${launch.endsIn} left` : (launch.endedAgo ?? '')
  // fixed-price: no trading, no fees, no rewards until the sale graduates
  const graduated = launch.status === 'graduated'

  return (
    <button
      onClick={onOpen}
      className="rise-in group flex cursor-pointer flex-col overflow-hidden rounded-2xl bg-surface text-left ring-1 ring-line transition duration-150 hover:-translate-y-1 hover:ring-line-2"
      style={{ animationDelay: `${index * 35}ms` }}
    >
      {/* coin art */}
      <div className="relative aspect-[16/10] w-full overflow-hidden" style={coinArt(ticker)}>
        <span className="font-display absolute inset-0 flex items-center justify-center text-[40px] font-extrabold tracking-tight text-white/95 drop-shadow-[0_2px_10px_rgba(0,0,0,0.35)]">
          {ticker}
        </span>
        <span className={`absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${s.cls}`}>
          {s.live && <span className="h-1.5 w-1.5 rounded-full bg-paper live-dot" />}
          {s.label}
        </span>
        <span className="tnum absolute right-3 top-3 rounded-full bg-black/35 px-2 py-1 text-[11px] font-semibold text-white backdrop-blur-sm">
          Fixed price
        </span>
      </div>

      {/* meta */}
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-display truncate text-[17px] font-bold leading-none tracking-tight text-ink group-hover:text-emerald-strong">
            {launch.name}
          </h3>
          <span className="tnum shrink-0 text-[12px] text-ink-3">${ticker}</span>
        </div>
        <p className="mt-1.5 line-clamp-1 text-[12px] text-ink-2">{launch.tagline}</p>

        <div className="mt-4 flex items-end justify-between">
          <div>
            <p className="eyebrow">Raised</p>
            <p className="tnum mt-1 text-[15px] font-semibold text-ink">{compact(launch.raised)} RBH</p>
          </div>
          <div className="text-right">
            {/* rewards only exist after graduation; before that show the flat price */}
            <p className="eyebrow">{graduated ? 'Paid out' : 'Price'}</p>
            <p className={`tnum mt-1 text-[15px] font-semibold ${graduated ? 'text-emerald-strong' : 'text-ink'}`}>
              {graduated ? `${compact(launch.rewardsPaid)} RBH` : `${price(launch.priceRbh)} RBH`}
            </p>
          </div>
        </div>

        {/* progress */}
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-line-2">
          <div
            className={`h-full rounded-full ${launch.status === 'refunding' ? 'bg-clay' : 'bg-emerald'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="tnum mt-2 flex items-center justify-between text-[11px] text-ink-3">
          <span>{pct.toFixed(0)}% of cap</span>
          <span>{age}</span>
        </div>
      </div>
    </button>
  )
}
