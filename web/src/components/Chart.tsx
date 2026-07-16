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

import { launchpadAbi, launchTokenAbi } from "@launchpad/sdk";

import { client } from "../lib/client";
import { compact, shortAddr } from "../lib/format";

const UP = "#33E07A";
const DOWN = "#FF5257";
const AXIS_TEXT = "#8b948a";
const GRID = "rgba(232, 237, 230, 0.05)";
const EDGE = "#1f241f";
const LABEL_BG = "#171b17";

const intervalLabels: Record<CandleInterval, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1H",
  "4h": "4H",
  "1d": "1D",
  "1w": "1W",
};

// Candles are aggregated in native price per token; the chart renders
// MARKET CAP in USD (price x supply x native/USD rate), so the axis reads
// like $2,000 instead of a micro per-token price.
function toCandleData(c: Candle, scale: number): CandlestickData<UTCTimestamp> {
  return {
    time: c.time as UTCTimestamp,
    open: Number(c.open) * scale,
    high: Number(c.high) * scale,
    low: Number(c.low) * scale,
    close: Number(c.close) * scale,
  };
}

function fmtMcap(v: number): string {
  if (!isFinite(v) || v <= 0) return "$0";
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 100_000) return `$${(v / 1e3).toFixed(0)}K`;
  if (v >= 100) return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  return `$${v.toFixed(2)}`;
}

function toVolumeData(c: Candle, usdRate: number): HistogramData<UTCTimestamp> {
  const up = Number(c.close) >= Number(c.open);
  return {
    time: c.time as UTCTimestamp,
    value: Number(c.volume) * usdRate,
    color: up ? "rgba(51, 224, 122, 0.4)" : "rgba(255, 82, 87, 0.4)",
  };
}

/** USD market cap per unit of native token price: usdRate x whole supply. */
async function fetchMcapScale(token: Address): Promise<number> {
  try {
    const [price8, supply] = await Promise.all([
      client.publicClient.readContract({
        address: client.addresses.factory,
        abi: launchpadAbi,
        functionName: "nativeUsdPrice",
      }),
      client.publicClient.readContract({
        address: token,
        abi: launchTokenAbi,
        functionName: "totalSupply",
      }),
    ]);
    const rate = Number(price8) / 1e8;
    const supplyWhole = Number(supply) / 1e18;
    const scale = rate * supplyWhole;
    return scale > 0 ? scale : 1;
  } catch {
    return 1;
  }
}

/** Compact contract-address chip with copy, docked in the chart toolbar. */
function CaChip({ address }: { address: Address }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(address).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        });
      }}
      title={copied ? "Copied" : "Copy contract address"}
      className={`mono flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors ${
        copied
          ? "border-up/40 bg-up/10 text-up"
          : "border-edge bg-panel-2/50 text-ink-2 hover:border-edge-2 hover:text-ink"
      }`}
    >
      <span className="text-ink-3">CA</span>
      <span>{shortAddr(address)}</span>
      {copied ? (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path d="M2 6.5l2.6 2.6L10 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
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
        textColor: AXIS_TEXT,
        fontFamily:
          "'JetBrains Mono', 'SF Mono', ui-monospace, Menlo, Consolas, monospace",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: GRID },
        horzLines: { color: GRID },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: AXIS_TEXT, labelBackgroundColor: LABEL_BG },
        horzLine: { color: AXIS_TEXT, labelBackgroundColor: LABEL_BG },
      },
      rightPriceScale: { borderColor: EDGE },
      timeScale: {
        borderColor: EDGE,
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
        formatter: (p: number) => fmtMcap(p),
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
        `<span style="color:${AXIS_TEXT}">O</span> <span style="color:${dir}">${fmtMcap(data.open)}</span>  ` +
        `<span style="color:${AXIS_TEXT}">H</span> <span style="color:${dir}">${fmtMcap(data.high)}</span>  ` +
        `<span style="color:${AXIS_TEXT}">L</span> <span style="color:${dir}">${fmtMcap(data.low)}</span>  ` +
        `<span style="color:${AXIS_TEXT}">C</span> <span style="color:${dir}">${fmtMcap(data.close)}</span>` +
        (vol ? `  <span style="color:${AXIS_TEXT}">Vol</span> <span style="color:#c9ff4d">$${compact(vol.value ?? 0)}</span>` : "");
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

  // Data load + live stream per token/interval, all rendered in USD.
  useEffect(() => {
    let cancelled = false;
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!candleSeries || !volumeSeries) return;

    let mcapScale = 1;
    let usdRate = 1;
    const load = async () => {
      mcapScale = await fetchMcapScale(token);
      const price8 = await client.publicClient
        .readContract({ address: client.addresses.factory, abi: launchpadAbi, functionName: "nativeUsdPrice" })
        .catch(() => 0n);
      usdRate = Number(price8) / 1e8 || 1;
      const candles = await client.getCandles(token, interval, { limit: 500 });
      if (cancelled || !candleSeriesRef.current) return;
      candleSeries.setData(candles.map((x) => toCandleData(x, mcapScale)));
      volumeSeries.setData(candles.map((x) => toVolumeData(x, usdRate)));
      chartRef.current?.timeScale().fitContent();
      setEmpty(candles.length === 0);
    };
    load().catch(() => setEmpty(true));

    const unsub = client.subscribeToCandles(token, interval, ({ candle }) => {
      if (cancelled || !candleSeriesRef.current) return;
      // In-place update of the active candle; appends automatically when a
      // new bucket opens. The chart object itself is untouched.
      candleSeriesRef.current.update(toCandleData(candle, mcapScale));
      volumeSeriesRef.current?.update(toVolumeData(candle, usdRate));
      setEmpty(false);
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [token, interval]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-edge px-3 py-2">
        <div className="flex items-center gap-1">
          {CANDLE_INTERVALS.map((iv) => (
            <button
              key={iv}
              onClick={() => setInterval(iv)}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                interval === iv ? "bg-accent text-black" : "text-ink-3 hover:text-ink"
              }`}
            >
              {intervalLabels[iv]}
            </button>
          ))}
        </div>
        <div className="flex min-w-0 items-center gap-3">
          <div
            ref={legendRef}
            className="mono hidden whitespace-pre text-[11px] lg:block"
            aria-live="off"
          />
          <CaChip address={token} />
        </div>
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
