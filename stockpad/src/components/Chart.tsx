import { useEffect, useMemo, useRef } from "react";
import { createChart, ColorType, CrosshairMode, LineStyle, type IChartApi } from "lightweight-charts";
import type { Candle } from "@launchpad/sdk";

import { hype, usd } from "../lib/format";

const SUPPLY = 1_000_000_000;

/** Dollar formatter that never falls back to exponent notation: tiny coin
 *  prices show as $0.00000253, larger figures as $1.2K / $3.4M. */
export function money(p: number): string {
  if (!isFinite(p) || p <= 0) return "$0";
  if (p >= 1e9) return `$${(p / 1e9).toFixed(2)}B`;
  if (p >= 1e6) return `$${(p / 1e6).toFixed(2)}M`;
  if (p >= 1e5) return `$${(p / 1e3).toFixed(1)}K`;
  if (p >= 100) return `$${Math.round(p).toLocaleString("en-US")}`;
  if (p >= 1) return `$${p.toFixed(2)}`;
  const decimals = Math.min(12, Math.max(2, -Math.floor(Math.log10(p)) + 2));
  return `$${p.toFixed(decimals)}`;
}

/** Market cap (or price) in USD over time as a filled line, with buy/sell
 *  volume bars underneath. No axes: the range is printed under the chart. */
export function Chart({ candles, hypeUsd, mode = "mcap", pairSymbol = "ETH" }: { candles: Candle[]; hypeUsd: number; mode?: "price" | "mcap"; pairSymbol?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const scale = (mode === "mcap" ? SUPPLY : 1) * hypeUsd;
  const rows = useMemo(() => candles
    .map((k) => ({ time: k.time, open: Number(k.open) * scale, high: Number(k.high) * scale, low: Number(k.low) * scale, close: Number(k.close) * scale, vol: Number(k.volume) }))
    .filter((d) => isFinite(d.close) && d.close > 0), [candles, scale]);
  const stats = useMemo(() => {
    if (rows.length === 0) return null;
    return { lo: Math.min(...rows.map((r) => r.low)), hi: Math.max(...rows.map((r) => r.high)), vol: rows.reduce((s, r) => s + r.vol, 0), rising: rows[rows.length - 1].close >= rows[0].open };
  }, [rows]);

  useEffect(() => {
    if (!ref.current || rows.length === 0) return;
    const css = getComputedStyle(document.documentElement);
    const v = (k: string, d: string) => css.getPropertyValue(k).trim() || d;
    const ink = v("--ink", "#0D1017"), ink3 = v("--ink3", "#8590A0");
    const up = v("--up", "#0B9E5A"), down = v("--down", "#E2383F");
    const accent = stats?.rising ? up : down;
    const c = createChart(ref.current, {
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: ink3, fontFamily: "Instrument Sans, system-ui, sans-serif", fontSize: 11, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: { visible: false },
      leftPriceScale: { visible: false },
      timeScale: { visible: false, rightOffset: 0, fixLeftEdge: true, fixRightEdge: true },
      crosshair: {
        mode: CrosshairMode.Magnet,
        horzLine: { color: ink3, width: 1, style: LineStyle.Dashed, labelVisible: false },
        vertLine: { color: ink3, width: 1, style: LineStyle.Dashed, labelBackgroundColor: ink },
      },
      handleScroll: false,
      handleScale: false,
      autoSize: true,
    });
    const area = c.addAreaSeries({
      lineColor: accent, lineWidth: 2, topColor: accent + "55", bottomColor: accent + "05",
      priceFormat: { type: "custom", minMove: 1e-12, formatter: money }, priceLineVisible: false, lastValueVisible: false, crosshairMarkerRadius: 4,
      priceScaleId: "right",
    });
    area.priceScale().applyOptions({ scaleMargins: { top: 0.06, bottom: 0.3 } });
    area.setData(rows.map((r) => ({ time: r.time as any, value: r.close })));
    const vol = c.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "vol", priceLineVisible: false, lastValueVisible: false });
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
    vol.setData(rows.map((r) => ({ time: r.time as any, value: r.vol, color: (r.close >= r.open ? up : down) + "B3" })));
    c.timeScale().fitContent();
    chart.current = c;
    return () => { c.remove(); chart.current = null; };
  }, [rows, stats]);

  return (
    <>
      <div ref={ref} className="chart" />
      {stats && (
        <div className="chart-foot">
          <span>Vol {hype(stats.vol, 3)} {pairSymbol} · {usd(stats.vol * hypeUsd, { compact: true })}</span>
          <span>{money(stats.lo)} — {money(stats.hi)}</span>
        </div>
      )}
    </>
  );
}
