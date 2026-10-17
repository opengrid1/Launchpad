import { useMemo } from "react";

import { usd } from "../lib/format";
import type { Candle } from "../lib/types";

const W = 640, H = 230, LINE_H = 160, LINE_TOP = 8, VOL_TOP = 182, VOL_H = 44;

/** Formats a value without exponent notation, in dollars or pair units. */
export function money(p: number, unit: string): string {
  if (!isFinite(p) || p <= 0) return unit === "$" ? "$0" : `0 ${unit}`;
  const f = (n: number, s: string) => (unit === "$" ? `$${n}${s}` : `${n}${s} ${unit}`);
  if (p >= 1e9) return f(Number((p / 1e9).toFixed(2)), "B");
  if (p >= 1e6) return f(Number((p / 1e6).toFixed(2)), "M");
  if (p >= 1e5) return f(Number((p / 1e3).toFixed(1)), "K");
  if (p >= 1000) return f(Number((p / 1e3).toFixed(2)), "K");
  if (p >= 100) return unit === "$" ? `$${Math.round(p).toLocaleString("en-US")}` : `${Math.round(p).toLocaleString("en-US")} ${unit}`;
  if (p >= 1) return unit === "$" ? `$${p.toFixed(2)}` : `${p.toFixed(2)} ${unit}`;
  const decimals = Math.min(12, Math.max(2, -Math.floor(Math.log10(p)) + 2));
  return unit === "$" ? `$${p.toFixed(decimals)}` : `${p.toFixed(decimals)} ${unit}`;
}

/** Market cap or price over time: a line with a gradient under it and volume
 *  bars at the foot. `scale` turns a pair-unit price into the displayed value
 *  (pair USD for dollars, 1 for pair units; times supply for market cap). */
export function Chart({ candles, pairDecimals, scale, unit, mode, supply, bucketMinutes }: { candles: Candle[]; pairDecimals: number; scale: number; unit: string; mode: "price" | "mcap"; supply: number; bucketMinutes: number }) {
  const d = useMemo(() => {
    const div = 10 ** pairDecimals;
    // Group five-minute candles into the chosen bucket.
    const ms = bucketMinutes * 60_000;
    const grouped: { t: number; o: number; c: number; v: number }[] = [];
    for (const k of candles) {
      const t = k.t - (k.t % ms);
      const o = Number(k.o) / div, c = Number(k.c) / div, v = Number(k.v) / div;
      const last = grouped[grouped.length - 1];
      if (last && last.t === t) { last.c = c; last.v += v; } else grouped.push({ t, o, c, v });
    }
    const mult = scale * (mode === "mcap" ? supply : 1);
    const pts = grouped.map((g) => ({ t: g.t, p: g.c * mult, o: g.o * mult, v: g.v * scale })).filter((x) => isFinite(x.p) && x.p > 0);
    if (pts.length === 1) pts.push({ ...pts[0], t: pts[0].t + ms });
    if (pts.length < 2) return null;
    const vals = pts.map((x) => x.p);
    const from = pts[0].o;
    const last = vals[vals.length - 1];
    const up = last >= from;
    const chg = from > 0 ? ((last - from) / from) * 100 : 0;
    const lo = Math.min(...vals, from), hi = Math.max(...vals, from);
    const pad = (hi - lo) * 0.08 || 1;
    const floor = Math.max(0, lo - pad), span = hi + pad - floor || 1;
    const maxV = Math.max(...pts.map((x) => x.v), 1e-9);
    const n = pts.length;
    const xs = pts.map((_, i) => (i / Math.max(n - 1, 1)) * W);
    const ys = vals.map((p) => LINE_TOP + (1 - (p - floor) / span) * LINE_H);
    const line = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
    const area = `0,${VOL_TOP - 6} ${line} ${W},${VOL_TOP - 6}`;
    const bw = Math.max(2.2, W / n - 0.8);
    const bars = pts.map((x, i) => ({ key: `${x.t}-${i}`, x: Math.max(0, xs[i] - bw / 2), h: Math.max(1.5, (x.v / maxV) * VOL_H), up: i === 0 || vals[i] >= vals[i - 1] }));
    const vol = pts.reduce((s, x) => s + x.v, 0);
    return { line, area, bars, bw, from, last, up, chg, lo, hi, vol };
  }, [candles, pairDecimals, scale, unit, mode, supply, bucketMinutes]);

  if (!d) return <div className="gc-empty">Chart loads with the first trade.</div>;
  const tone = d.up ? "up" : "down";
  const gid = d.up ? "gcUp" : "gcDown";
  return (
    <div>
      <div className="gc-h">
        <b className={tone}>{money(d.last, unit)}<span>{d.chg >= 0 ? "+" : ""}{d.chg.toFixed(1)}%</span></b>
        <span className="from">{mode === "mcap" ? "Mcap" : "Price"} · from {money(d.from, unit)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="gc" role="img" aria-label={`${mode === "mcap" ? "market cap" : "price"} chart`}>
        <defs>
          <linearGradient id="gcUp" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--up)" stopOpacity="0.42" /><stop offset="100%" stopColor="var(--up)" stopOpacity="0" /></linearGradient>
          <linearGradient id="gcDown" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--down)" stopOpacity="0.38" /><stop offset="100%" stopColor="var(--down)" stopOpacity="0" /></linearGradient>
        </defs>
        <polygon points={d.area} fill={`url(#${gid})`} />
        <polyline points={d.line} fill="none" stroke={d.up ? "var(--up)" : "var(--down)"} strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {d.bars.map((b) => <rect key={b.key} x={b.x} y={VOL_TOP + (VOL_H + 4 - b.h)} width={d.bw} height={b.h} fill={b.up ? "var(--up)" : "var(--down)"} opacity="0.75" />)}
      </svg>
      <div className="gc-f">
        <span>Vol {unit === "$" ? usd(d.vol, { compact: true }) : money(d.vol, unit)}</span>
        <span>{money(d.lo, unit)} — {money(d.hi, unit)}</span>
      </div>
    </div>
  );
}
