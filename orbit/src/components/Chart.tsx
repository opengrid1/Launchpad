import { useEffect, useRef } from "react";
import { createChart, ColorType, type IChartApi } from "lightweight-charts";
import type { Candle } from "@launchpad/sdk";

/** Price in USD over time. Area chart: the shape of the move is what matters
 *  on a coin page, not OHLC noise. */
export function Chart({ candles, hypeUsd }: { candles: Candle[]; hypeUsd: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const css = getComputedStyle(document.documentElement);
    const ink2 = css.getPropertyValue("--ink2").trim() || "#6E6E73";
    const line = css.getPropertyValue("--line").trim() || "#26262A";
    const up = candles.length > 1 && Number(candles[candles.length - 1].close) >= Number(candles[0].open);
    const color = up ? (css.getPropertyValue("--up").trim() || "#1D9E4B") : (css.getPropertyValue("--down").trim() || "#E0262D");
    const c = createChart(ref.current, {
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: ink2, fontFamily: "JetBrains Mono, ui-monospace, monospace", fontSize: 11 },
      grid: { vertLines: { visible: false }, horzLines: { color: line } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.08 } },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      crosshair: { horzLine: { visible: true, labelVisible: true }, vertLine: { labelVisible: true } },
      handleScroll: { vertTouchDrag: false },
      autoSize: true,
    });
    const s = c.addAreaSeries({
      lineColor: color, lineWidth: 2, topColor: color + "33", bottomColor: color + "00",
      priceFormat: { type: "custom", minMove: 1e-9, formatter: (p: number) => (p < 0.01 ? "$" + p.toPrecision(3) : "$" + p.toFixed(4)) },
    });
    const data = candles
      .map((k) => ({ time: k.time as any, value: (Number(k.close) / 1e18) * hypeUsd }))
      .filter((d) => isFinite(d.value) && d.value > 0);
    s.setData(data);
    c.timeScale().fitContent();
    chart.current = c;
    return () => { c.remove(); chart.current = null; };
  }, [candles, hypeUsd]);
  return <div ref={ref} className="chart" />;
}
