/** Minimal live line/area chart. Auto-scales, colours by direction. */
export function LiveChart({ points, up, height = 260 }: { points: number[]; up: boolean; height?: number }) {
  const W = Math.max(points.length - 1, 1)
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const H = 100
  const y = (v: number) => H - ((v - min) / span) * H
  const line = points.map((p, i) => `${i},${y(p).toFixed(2)}`).join(' ')
  const area = `0,${H} ${line} ${W},${H}`
  const color = up ? 'var(--color-emerald)' : 'var(--color-clay)'
  const gid = up ? 'gUp' : 'gDown'

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={height} className="block">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gid})`} />
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth="1.4"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* live head dot */}
      <circle cx={W} cy={y(points[points.length - 1])} r="2.4" fill={color} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

interface Candle { o: number; c: number; h: number; l: number }

/** Live candlestick chart. Groups the price feed into OHLC candles. */
export function CandleChart({ points, group = 3, height = 300 }: { points: number[]; group?: number; height?: number }) {
  const candles: Candle[] = []
  for (let i = 0; i < points.length; i += group) {
    const slice = points.slice(i, i + group)
    if (slice.length) candles.push({ o: slice[0], c: slice[slice.length - 1], h: Math.max(...slice), l: Math.min(...slice) })
  }
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const pad = span * 0.08
  const lo = min - pad
  const hi = max + pad
  const H = 100
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * H
  const n = candles.length || 1
  const cw = 100 / n
  const last = candles[candles.length - 1]
  const lastUp = last ? last.c >= last.o : true

  return (
    <div className="relative">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height={height} className="block">
        {/* faint gridlines */}
        {[0.25, 0.5, 0.75].map((g) => (
          <line key={g} x1="0" x2="100" y1={g * 100} y2={g * 100} stroke="var(--color-line)" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
        ))}
        {candles.map((cd, i) => {
          const x = i * cw + cw / 2
          const up = cd.c >= cd.o
          const color = up ? 'var(--color-emerald)' : 'var(--color-clay)'
          const top = y(Math.max(cd.o, cd.c))
          const bot = y(Math.min(cd.o, cd.c))
          const bw = cw * 0.62
          return (
            <g key={i}>
              <line x1={x} x2={x} y1={y(cd.h)} y2={y(cd.l)} stroke={color} strokeWidth="1" vectorEffect="non-scaling-stroke" />
              <rect x={x - bw / 2} y={top} width={bw} height={Math.max(bot - top, 0.6)} fill={color} />
            </g>
          )
        })}
      </svg>
      {/* live price marker */}
      {last && (
        <div
          className="pointer-events-none absolute right-0 flex -translate-y-1/2 items-center"
          style={{ top: `${(y(last.c) / 100) * height}px` }}
        >
          <span className="h-px w-full" />
          <span className={`tnum rounded px-1 py-0.5 text-[10px] font-semibold ${lastUp ? 'bg-emerald text-paper' : 'bg-clay text-paper'}`}>
            {last.c.toLocaleString('en-US', { maximumSignificantDigits: 3 })}
          </span>
        </div>
      )}
    </div>
  )
}

/** Tiny inline sparkline for cards. */
export function Sparkline({ points, up }: { points: number[]; up: boolean }) {
  const W = Math.max(points.length - 1, 1)
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const H = 100
  const line = points.map((p, i) => `${i},${(H - ((p - min) / span) * H).toFixed(2)}`).join(' ')
  const color = up ? 'var(--color-emerald)' : 'var(--color-clay)'
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height="36" className="block">
      <polyline points={line} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  )
}
