import { useEffect, useRef } from "react";
import { createChart, ColorType, CrosshairMode, LineStyle, type IChartApi } from "lightweight-charts";
import type { Candle } from "@launchpad/sdk";

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

/** Price (or market cap) in USD over time. Candlesticks when there is enough
 *  history to read a shape, an area line before that. */
export function Chart({ candles, hypeUsd, mode = "mcap" }: { candles: Candle[]; hypeUsd: number; mode?: "price" | "mcap" }) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const css = getComputedStyle(document.documentElement);
    const v = (k: string, d: string) => css.getPropertyValue(k).trim() || d;
    const ink = v("--ink", "#0D1017"), ink2 = v("--ink2", "#4E5766"), ink3 = v("--ink3", "#8590A0"), line = v("--line", "#E1E4EA");
    const up = v("--up", "#0B9E5A"), down = v("--down", "#E2383F");
    const scale = (mode === "mcap" ? SUPPLY : 1) * hypeUsd;
    const rows = candles
      .map((k) => ({ time: k.time as any, open: Number(k.open) * scale, high: Number(k.high) * scale, low: Number(k.low) * scale, close: Number(k.close) * scale }))
      .filter((d) => isFinite(d.close) && d.close > 0);
    const rising = rows.length > 1 && rows[rows.length - 1].close >= rows[0].open;
    const accent = rising ? up : down;

    const c = createChart(ref.current, {
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: ink3, fontFamily: "Instrument Sans, system-ui, sans-serif", fontSize: 12, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: line, style: LineStyle.Solid } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.14, bottom: 0.1 }, entireTextOnly: true },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 4, fixLeftEdge: true },
      crosshair: {
        mode: CrosshairMode.Magnet,
        horzLine: { color: ink2, width: 1, style: LineStyle.Dashed, labelBackgroundColor: ink },
        vertLine: { color: ink2, width: 1, style: LineStyle.Dashed, labelBackgroundColor: ink },
      },
      handleScroll: { vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: false },
      autoSize: true,
    });
    const priceFormat = { type: "custom" as const, minMove: 1e-12, formatter: money };
    if (rows.length >= 12) {
      const s = c.addCandlestickSeries({
        upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down,
        priceFormat, priceLineColor: accent, priceLineStyle: LineStyle.Dotted, lastValueVisible: true,
      });
      s.setData(rows);
    } else {
      const s = c.addAreaSeries({
        lineColor: accent, lineWidth: 2, topColor: accent + "40", bottomColor: accent + "00",
        priceFormat, priceLineColor: accent, priceLineStyle: LineStyle.Dotted, crosshairMarkerRadius: 4,
      });
      s.setData(rows.map((r) => ({ time: r.time, value: r.close })));
    }
    c.timeScale().fitContent();
    chart.current = c;
    return () => { c.remove(); chart.current = null; };
  }, [candles, hypeUsd, mode]);
  return <div ref={ref} className="chart" />;
}
