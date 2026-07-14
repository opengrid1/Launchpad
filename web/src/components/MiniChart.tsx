import { useQuery } from "@tanstack/react-query";
import type { Address } from "@launchpad/sdk";

import { client } from "../lib/client";

const UP = "#0E9F4E";
const DOWN = "#E5484D";

/**
 * Miniature OHLC candle strip rendered as SVG from real 15m candles.
 * Purely presentational: no axes, no interaction, just the shape of the
 * market since launch.
 */
export function MiniChart({ token, width = 132, height = 44 }: { token: Address; width?: number; height?: number }) {
  const { data: candles } = useQuery({
    queryKey: ["mini-candles", token],
    queryFn: () => client.getCandles(token, "15m", { limit: 24 }),
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  if (!candles || candles.length === 0) {
    return (
      <svg width={width} height={height} aria-hidden>
        <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="#E8E8E2" strokeWidth="1.5" strokeDasharray="3 4" />
      </svg>
    );
  }

  const values = candles.flatMap((c) => [Number(c.high), Number(c.low)]);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || max || 1;
  const y = (v: number) => 2 + (height - 4) * (1 - (v - min) / span);

  const n = candles.length;
  const slot = width / Math.max(n, 12);
  const bodyW = Math.max(Math.min(slot * 0.55, 6), 2);

  return (
    <svg width={width} height={height} aria-label="Recent price candles" role="img">
      {candles.map((c, i) => {
        const open = Number(c.open);
        const close = Number(c.close);
        const up = close >= open;
        const color = up ? UP : DOWN;
        const cx = width - (n - i - 0.5) * slot;
        const top = y(Math.max(open, close));
        const bottom = y(Math.min(open, close));
        return (
          <g key={c.time}>
            <line x1={cx} y1={y(Number(c.high))} x2={cx} y2={y(Number(c.low))} stroke={color} strokeWidth="1" />
            <rect
              x={cx - bodyW / 2}
              y={top}
              width={bodyW}
              height={Math.max(bottom - top, 1.5)}
              rx="1"
              fill={color}
            />
          </g>
        );
      })}
    </svg>
  );
}
