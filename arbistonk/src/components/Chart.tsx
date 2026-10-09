import { useMemo } from "react";
import type { Candle } from "@launchpad/sdk";

import { usd } from "../lib/format";

const SUPPLY = 1_000_000_000;
const W = 640, H = 230, LINE_H = 160, LINE_TOP = 8, VOL_TOP = 182, VOL_H = 44;

/** Dollar formatter that never falls back to exponent notation: tiny coin
 *  prices show as $0.00000253, larger figures as $1.2K / $3.4M. */
export function money(p: number): string {
  if (!isFinite(p) || p <= 0) return "$0";
  if (p >= 1e9) return `$${(p / 1e9).toFixed(2)}B`;
  if (p >= 1e6) return `$${(p / 1e6).toFixed(2)}M`;
  if (p >= 1e5) return `$${(p / 1e3).toFixed(1)}K`;
  if (p >= 1000) return `$${(p / 1e3).toFixed(2)}K`;
  if (p >= 100) return `$${Math.round(p).toLocaleString("en-US")}`;
  if (p >= 1) return `$${p.toFixed(2)}`;
  const decimals = Math.min(12, Math.max(2, -Math.floor(Math.log10(p)) + 2));
  return `$${p.toFixed(decimals)}`;
}

/** Market cap (or price) over time as one stretched SVG: a line with a
 *  gradient under it and buy/sell volume bars at the foot. No axes. The
 *  header carries the latest value and the move since the first point;
 *  the footer the volume and the low-high range. */
export function Chart({ candles, hypeUsd, mode = "mcap", startUsd = 3000, volumeUsd }: { candles: Candle[]; hypeUsd: number; mode?: "price" | "mcap"; startUsd?: number; volumeUsd?: number }) {
  const scale = (mode === "mcap" ? SUPPLY : 1) * hypeUsd;
  const d = useMemo(() => {
    const pts = candles.map((k) => ({ t: k.time, p: Number(k.close) * scale, o: Number(k.open) * scale, v: Number(k.volume) * hypeUsd })).filter((x) => isFinite(x.p) && x.p > 0);
    if (pts.length === 1) pts.push({ ...pts[0], t: pts[0].t + 60 });
    if (pts.length < 2) return null;
    const vals = pts.map((x) => x.p);
    const from = mode === "mcap" ? Math.min(vals[0], startUsd) : vals[0];
    const last = vals[vals.length - 1];
    const up = last >= from;
    const chg = from > 0 ? ((last - from) / from) * 100 : 0;
    const lo = Math.min(...vals, from), hi = Math.max(...vals);
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
  }, [candles, scale, hypeUsd, mode, startUsd]);

  if (!d) return <div className="gc-empty">Chart loads with the first trade.</div>;
  const tone = d.up ? "up" : "down";
  const gid = d.up ? "gcUp" : "gcDown";
  return (
    <div>
      <div className="gc-h">
        <b className={tone}>{money(d.last)}<span>{d.chg >= 0 ? "+" : ""}{d.chg.toFixed(1)}%</span></b>
        <span className="from">{mode === "mcap" ? "Mcap" : "Price"} · from {money(d.from)}</span>
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
        <span>Vol {usd(volumeUsd ?? d.vol, { compact: true })}</span>
        <span>{money(d.lo)} — {money(d.hi)}</span>
      </div>
    </div>
  );
}
