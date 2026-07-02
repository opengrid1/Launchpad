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
