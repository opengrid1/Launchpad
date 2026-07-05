import { useEffect, useRef } from 'react'
import { createChart, CandlestickSeries, AreaSeries, ColorType, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts'

const C = {
  line: '#2a2c32',
  line2: '#3a3d45',
  ink3: '#64685c',
  emerald: '#b6f23c',
  clay: '#e2704a',
}

/** TradingView Lightweight Charts, fed by on-chain history. Uses candles when
 *  there's enough history, an area line when the data is still sparse. */
type OHLC = { time: number; open: number; high: number; low: number; close: number }

export function TVChart({
  points,
  candles,
  group = 3,
  height = 320,
  formatter,
  variant = 'candle',
}: {
  points: number[]
  candles?: OHLC[]
  group?: number
  height?: number
  formatter?: (v: number) => string
  variant?: 'candle' | 'area'
}) {
  const elRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | ISeriesApi<'Area'> | null>(null)
  const fitRef = useRef(false)
  const groupRef = useRef(group)

  useEffect(() => {
    const el = elRef.current
    if (!el) return
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: C.ink3,
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        fontSize: 11,
      },
      grid: { vertLines: { color: C.line }, horzLines: { color: C.line } },
      rightPriceScale: { borderColor: C.line, scaleMargins: { top: 0.15, bottom: 0.15 } },
      timeScale: { borderColor: C.line, timeVisible: false, secondsVisible: false },
      crosshair: {
        vertLine: { color: C.line2, labelBackgroundColor: C.line2 },
        horzLine: { color: C.line2, labelBackgroundColor: C.line2 },
      },
    })
    const priceFormat = {
      type: 'custom' as const,
      formatter: (p: number) => (formatter ? formatter(p) : Number(p).toPrecision(3)),
      minMove: formatter ? 1 : 1e-10,
    }
    const series =
      variant === 'area'
        ? chart.addSeries(AreaSeries, {
            lineColor: C.emerald,
            lineWidth: 2,
            topColor: 'rgba(182,242,60,0.22)',
            bottomColor: 'rgba(182,242,60,0.02)',
            priceFormat,
          })
        : chart.addSeries(CandlestickSeries, {
            upColor: C.emerald,
            downColor: C.clay,
            borderVisible: false,
            wickUpColor: C.emerald,
            wickDownColor: C.clay,
            priceFormat,
          })
    chartRef.current = chart
    seriesRef.current = series
    fitRef.current = false
    return () => {
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      fitRef.current = false
    }
  }, [variant])

  useEffect(() => {
    const series = seriesRef.current
    if (!series) return
    const base = 1_700_000_000

    let candleCount = 0

    if (variant === 'area') {
      const data = points.map((v, i) => ({ time: (base + i * 60) as UTCTimestamp, value: v }))
      ;(series as ISeriesApi<'Area'>).setData(data)
    } else if (candles && candles.length) {
      // real, time-bucketed OHLC from on-chain swaps
      ;(series as ISeriesApi<'Candlestick'>).setData(candles.map((c) => ({ ...c, time: c.time as UTCTimestamp })))
      candleCount = candles.length
    } else {
      const built = []
      for (let i = 0; i < points.length; i += group) {
        const slice = points.slice(i, i + group)
        if (!slice.length) continue
        built.push({
          time: (base + built.length * 60) as UTCTimestamp,
          open: slice[0],
          high: Math.max(...slice),
          low: Math.min(...slice),
          close: slice[slice.length - 1],
        })
      }
      ;(series as ISeriesApi<'Candlestick'>).setData(built)
    }
    const ts = chartRef.current?.timeScale()
    if (candleCount > 0) {
      // anchor newest candle to the right; show ~70 recent bars, scroll for more
      const visible = Math.min(candleCount, 70)
      ts?.setVisibleLogicalRange({ from: candleCount - visible, to: candleCount })
      groupRef.current = group
    } else if (!fitRef.current || groupRef.current !== group) {
      ts?.fitContent()
      fitRef.current = true
      groupRef.current = group
    }
  }, [points, candles, group, variant])

  return <div ref={elRef} style={{ width: '100%', height }} />
}
