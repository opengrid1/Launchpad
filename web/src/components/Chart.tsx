import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  HistogramSeries,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Address, Candle, CandleInterval } from "@launchpad/sdk";
import { CANDLE_INTERVALS } from "@launchpad/sdk";

import { client } from "../lib/client";
import { env } from "../lib/env";
import { fmtSmall, compact } from "../lib/format";

const UP = "#1fa971";
const DOWN = "#f6465d";

const intervalLabels: Record<CandleInterval, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1h": "1H",
  "4h": "4H",
  "1d": "1D",
};

function toCandleData(c: Candle): CandlestickData<UTCTimestamp> {
  return {
    time: c.time as UTCTimestamp,
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
  };
}

function toVolumeData(c: Candle): HistogramData<UTCTimestamp> {
  const up = Number(c.close) >= Number(c.open);
  return {
    time: c.time as UTCTimestamp,
    value: Number(c.volume),
    color: up ? "rgba(31, 169, 113, 0.45)" : "rgba(246, 70, 93, 0.45)",
  };
}

/**
 * TradingView Lightweight Charts candlestick + volume panel. The initial
 * series loads over REST; afterwards the active candle updates in place from
 * the WebSocket stream (series.update), so the chart is never recreated.
 */
export function PriceChart({ token }: { token: Address }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const legendRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const [interval, setInterval] = useState<CandleInterval>("1m");
  const [empty, setEmpty] = useState(false);

  // Chart construction, once per mount.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#9aa3b2",
        fontFamily:
          "Inter, 'SF Pro Text', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(46, 52, 64, 0.35)" },
        horzLines: { color: "rgba(46, 52, 64, 0.35)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "#626b7a", labelBackgroundColor: "#2e3440" },
        horzLine: { color: "#626b7a", labelBackgroundColor: "#2e3440" },
      },
      rightPriceScale: { borderColor: "rgba(46, 52, 64, 0.8)" },
      timeScale: {
        borderColor: "rgba(46, 52, 64, 0.8)",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4,
      },
      handleScroll: true,
      handleScale: true,
      autoSize: false,
      width: container.clientWidth,
      height: container.clientHeight,
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
      priceFormat: {
        type: "custom",
        formatter: (p: number) => fmtSmall(p),
        minMove: 1e-12,
      },
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
      visible: false,
    });
    candleSeries.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.22 } });

    // OHLC readout on hover, written straight to the DOM.
    chart.subscribeCrosshairMove((param) => {
      const legend = legendRef.current;
      if (!legend) return;
      const data = param.seriesData.get(candleSeries) as CandlestickData | undefined;
      const vol = param.seriesData.get(volumeSeries) as HistogramData | undefined;
      if (!data) {
        legend.textContent = "";
        return;
      }
      const dir = data.close >= data.open ? UP : DOWN;
      legend.innerHTML =
        `<span style="color:#626b7a">O</span> <span style="color:${dir}">${fmtSmall(data.open)}</span>  ` +
        `<span style="color:#626b7a">H</span> <span style="color:${dir}">${fmtSmall(data.high)}</span>  ` +
        `<span style="color:#626b7a">L</span> <span style="color:${dir}">${fmtSmall(data.low)}</span>  ` +
        `<span style="color:#626b7a">C</span> <span style="color:${dir}">${fmtSmall(data.close)}</span>` +
        (vol ? `  <span style="color:#626b7a">Vol</span> <span style="color:#9aa3b2">${compact(vol.value ?? 0)} ${env.nativeSymbol}</span>` : "");
    });

    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      chart.applyOptions({ width: rect.width, height: rect.height });
    });
    observer.observe(container);

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, []);

  // Data load + live stream per token/interval.
  useEffect(() => {
    let cancelled = false;
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!candleSeries || !volumeSeries) return;

    client
      .getCandles(token, interval, { limit: 500 })
      .then((candles) => {
        if (cancelled || !candleSeriesRef.current) return;
        candleSeries.setData(candles.map(toCandleData));
        volumeSeries.setData(candles.map(toVolumeData));
        chartRef.current?.timeScale().fitContent();
        setEmpty(candles.length === 0);
      })
      .catch(() => setEmpty(true));

    const unsub = client.subscribeToCandles(token, interval, ({ candle }) => {
      if (cancelled || !candleSeriesRef.current) return;
      // In-place update of the active candle; appends automatically when a
      // new bucket opens. The chart object itself is untouched.
      candleSeriesRef.current.update(toCandleData(candle));
      volumeSeriesRef.current?.update(toVolumeData(candle));
      setEmpty(false);
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [token, interval]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-edge px-3 py-2">
        <div className="flex items-center gap-1">
          {CANDLE_INTERVALS.map((iv) => (
            <button
              key={iv}
              onClick={() => setInterval(iv)}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                interval === iv ? "bg-panel-2 text-ink" : "text-ink-3 hover:text-ink-2"
              }`}
            >
              {intervalLabels[iv]}
            </button>
          ))}
        </div>
        <div
          ref={legendRef}
          className="tnum hidden whitespace-pre text-[11px] sm:block"
          aria-live="off"
        />
      </div>
      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="absolute inset-0 touch-pan-x touch-pan-y" />
        {empty ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <p className="text-sm text-ink-3">No trades yet. The first trade starts the chart.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
