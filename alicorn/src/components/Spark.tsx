import { useCandles } from "../lib/hooks";

/** A small price line from the last hours of candles, coloured by direction. */
export function Spark({ token, up, width = 120, height = 36 }: { token: string; up: boolean | null; width?: number; height?: number }) {
  const { data } = useCandles(token, "1h");
  const closes = (data ?? []).slice(-48).map((c) => Number(c.close)).filter((v) => isFinite(v) && v > 0);
  if (closes.length < 2) return <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden><line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="var(--line2)" strokeDasharray="3 3" /></svg>;
  const min = Math.min(...closes), max = Math.max(...closes);
  const span = max - min || max || 1;
  const pts = closes.map((v, i) => [(i / (closes.length - 1)) * width, height - 3 - ((v - min) / span) * (height - 6)] as const);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const tone = up == null ? (closes[closes.length - 1] >= closes[0] ? "var(--up)" : "var(--down)") : up ? "var(--up)" : "var(--down)";
  const id = `sp-${token.slice(-6)}`;
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={tone} stopOpacity=".35" /><stop offset="1" stopColor={tone} stopOpacity="0" /></linearGradient></defs>
      <polygon points={`0,${height} ${line} ${width},${height}`} fill={`url(#${id})`} />
      <polyline points={line} fill="none" stroke={tone} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2.4" fill={tone} />
    </svg>
  );
}
