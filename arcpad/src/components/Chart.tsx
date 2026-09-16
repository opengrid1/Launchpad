import { useEffect, useMemo, useRef } from "react";
import { ColorType, CrosshairMode, createChart, type IChartApi, type UTCTimestamp } from "lightweight-charts";
import type { Candle } from "@launchpad/sdk";

import { usd } from "../lib/format";

const SUPPLY = 1_000_000_000;

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

const cssVar = (name: string, fallback: string) => (typeof window === "undefined" ? fallback : getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback);

/** TradingView-style candles (Lightweight Charts) with a volume histogram
 *  underneath, a price scale on the right and a time scale at the foot.
 *  The header carries the latest value and the move since the first candle. */
export function Chart({ candles, hypeUsd, mode = "mcap", startUsd = 3000, volumeUsd }: { candles: Candle[]; hypeUsd: number; mode?: "price" | "mcap"; startUsd?: number; volumeUsd?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const scale = (mode === "mcap" ? SUPPLY : 1) * hypeUsd;

  const d = useMemo(() => {
    const rows = candles
      .map((k) => ({ time: k.time as UTCTimestamp, open: Number(k.open) * scale, high: Number(k.high) * scale, low: Number(k.low) * scale, close: Number(k.close) * scale, volume: Number(k.volume) * hypeUsd }))
      .filter((x) => isFinite(x.close) && x.close > 0)
      .sort((a, b) => a.time - b.time)
      .filter((x, i, arr) => i === 0 || x.time !== arr[i - 1].time);
    if (rows.length === 0) return null;
    const first = rows[0].open || rows[0].close;
    const from = mode === "mcap" ? Math.min(first, startUsd) : first;
    const last = rows[rows.length - 1].close;
    const chg = from > 0 ? ((last - from) / from) * 100 : 0;
    const lo = Math.min(...rows.map((r) => r.low)), hi = Math.max(...rows.map((r) => r.high));
    const vol = rows.reduce((s, r) => s + r.volume, 0);
    return { rows, from, last, chg, up: last >= from, lo, hi, vol };
  }, [candles, scale, hypeUsd, mode, startUsd]);

  useEffect(() => {
    const el = box.current;
    if (!el || !d) return;
    const up = cssVar("--up", "#0E7C4A"), down = cssVar("--down", "#D14424");
    const ink3 = cssVar("--ink3", "#5B636B"), line = cssVar("--line", "#DFE5EC"), mono = cssVar("--mono", "Space Mono, monospace");
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: ink3, fontFamily: mono, fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: line, style: 1 }, horzLines: { color: line, style: 1 } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.26 } },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 2, barSpacing: 8, minBarSpacing: 3 },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: ink3, width: 1, style: 3, labelBackgroundColor: cssVar("--ink", "#1B3158") }, horzLine: { color: ink3, width: 1, style: 3, labelBackgroundColor: cssVar("--ink", "#1B3158") } },
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true },
      localization: { priceFormatter: (p: number) => money(p) },
    });
    chartRef.current = chart;
    const series = chart.addCandlestickSeries({
      upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down,
      priceFormat: { type: "custom", formatter: (p: number) => money(p), minMove: 1e-12 },
    });
    series.setData(d.rows.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    const vol = chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false });
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 }, borderVisible: false });
    vol.setData(d.rows.map((r) => ({ time: r.time, value: r.volume, color: r.close >= r.open ? up + "99" : down + "99" })));
    chart.timeScale().fitContent();
    return () => { chart.remove(); chartRef.current = null; };
  }, [d]);

  if (!d) return <div className="gc-empty">Chart loads with the first trade.</div>;
  const tone = d.up ? "up" : "down";
  return (
    <div>
      <div className="gc-h">
        <b className={tone}>{money(d.last)}<span>{d.chg >= 0 ? "+" : ""}{d.chg.toFixed(1)}%</span></b>
        <span className="from">{mode === "mcap" ? "Mcap" : "Price"} · from {money(d.from)}</span>
      </div>
      <div ref={box} className="gc tv" role="img" aria-label={`${mode === "mcap" ? "market cap" : "price"} candlestick chart`} />
      <div className="gc-f">
        <span>Vol {usd(volumeUsd ?? d.vol, { compact: true })}</span>
        <span>{money(d.lo)} — {money(d.hi)}</span>
      </div>
    </div>
  );
}
