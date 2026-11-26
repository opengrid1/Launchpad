/** Progress ring for the curve, 0 to 100. Green once the pool is open. */
export function Ring({ pct, size = 40, stroke = 4, pool = false, label = true }: { pct: number; size?: number; stroke?: number; pool?: boolean; label?: boolean }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, pct));
  return (
    <span className={"ring" + (pool ? " pool" : "")} style={{ width: size, height: size }} aria-label={`${p.toFixed(0)}% of the curve sold`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle className="bg" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} />
        <circle className="fg" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} strokeDasharray={c} strokeDashoffset={c * (1 - p / 100)} />
      </svg>
      {label && <b>{pool ? "✓" : `${Math.round(p)}`}</b>}
    </span>
  );
}
