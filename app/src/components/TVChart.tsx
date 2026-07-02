import { useEffect, useRef } from 'react'
import { createChart, CandlestickSeries, ColorType, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts'

const C = {
  line: '#2a2c32',
  line2: '#3a3d45',
  ink3: '#64685c',
  emerald: '#b6f23c',
  clay: '#e2704a',
}

/** TradingView Lightweight Charts candlestick, fed by the live feed. */
export function TVChart({
  points,
  group = 3,
  height = 320,
  formatter,
}: {
  points: number[]
  group?: number
  height?: number
  formatter?: (v: number) => string
}) {
  const elRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
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
      rightPriceScale: { borderColor: C.line, scaleMargins: { top: 0.12, bottom: 0.12 } },
      timeScale: { borderColor: C.line, timeVisible: false, secondsVisible: false },
      crosshair: {
        vertLine: { color: C.line2, labelBackgroundColor: C.line2 },
        horzLine: { color: C.line2, labelBackgroundColor: C.line2 },
      },
    })
    const series = chart.addSeries(CandlestickSeries, {
      upColor: C.emerald,
      downColor: C.clay,
      borderVisible: false,
      wickUpColor: C.emerald,
      wickDownColor: C.clay,
      priceFormat: {
        type: 'custom',
        formatter: (p: number) => (formatter ? formatter(p) : Number(p).toPrecision(3)),
        minMove: formatter ? 1 : 1e-10,
      },
    })
    chartRef.current = chart
    seriesRef.current = series
    return () => {
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      fitRef.current = false
    }
  }, [])

  useEffect(() => {
    const series = seriesRef.current
    if (!series) return
    const base = 1_700_000_000
    const candles = []
    for (let i = 0; i < points.length; i += group) {
      const slice = points.slice(i, i + group)
      if (!slice.length) continue
      candles.push({
        time: (base + candles.length * 60) as UTCTimestamp,
        open: slice[0],
        high: Math.max(...slice),
        low: Math.min(...slice),
        close: slice[slice.length - 1],
      })
    }
    series.setData(candles)
    if (!fitRef.current || groupRef.current !== group) {
      chartRef.current?.timeScale().fitContent()
      fitRef.current = true
      groupRef.current = group
    }
  }, [points, group])

  return <div ref={elRef} style={{ width: '100%', height }} />
}
