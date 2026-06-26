import { useEffect, useRef } from 'react'

export function RobinhoodFeather({ size = 48 }: { size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width  = size * dpr
    canvas.height = size * dpr
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, size, size)

    draw(ctx, size)
  }, [size])

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{ width: size, height: size, display: 'block' }}
    />
  )
}

function draw(ctx: CanvasRenderingContext2D, s: number) {
  // All coordinates are expressed as fractions of `s` so the feather
  // scales perfectly to any size.
  const w = s
  const h = s

  // ── colour stops ───────────────────────────────────────────────
  const G_MAIN = '#00C805'
  const G_LIGHT = '#33dd2e'
  const G_DARK  = '#009604'

  // ── LEFT vane ─────────────────────────────────────────────────
  // A curved half-leaf that sweeps from the tip down to the base left.
  ctx.beginPath()
  ctx.moveTo(w * 0.50, h * 0.04)           // tip
  ctx.bezierCurveTo(
    w * 0.26, h * 0.10,                    // cp1 — sweeps left near top
    w * 0.10, h * 0.42,                    // cp2 — widens toward middle
    w * 0.20, h * 0.88,                    // base-left corner
  )
  ctx.bezierCurveTo(
    w * 0.32, h * 0.96,                    // cp1 — rounds base
    w * 0.44, h * 0.94,                    // cp2 — joins stem
    w * 0.50, h * 0.92,                    // bottom of stem
  )
  ctx.closePath()

  const lgLeft = ctx.createLinearGradient(w * 0.1, h * 0.04, w * 0.5, h * 0.9)
  lgLeft.addColorStop(0,   G_LIGHT)
  lgLeft.addColorStop(0.5, G_MAIN)
  lgLeft.addColorStop(1,   G_DARK)
  ctx.fillStyle = lgLeft
  ctx.fill()

  // ── RIGHT vane ────────────────────────────────────────────────
  ctx.beginPath()
  ctx.moveTo(w * 0.50, h * 0.04)           // tip (same start)
  ctx.bezierCurveTo(
    w * 0.72, h * 0.10,                    // cp1 — sweeps right
    w * 0.86, h * 0.40,                    // cp2 — widens
    w * 0.78, h * 0.86,                    // base-right corner
  )
  ctx.bezierCurveTo(
    w * 0.70, h * 0.95,                    // cp1
    w * 0.57, h * 0.94,                    // cp2
    w * 0.50, h * 0.92,                    // bottom of stem
  )
  ctx.closePath()

  const lgRight = ctx.createLinearGradient(w * 0.9, h * 0.04, w * 0.5, h * 0.9)
  lgRight.addColorStop(0,   G_LIGHT)
  lgRight.addColorStop(0.5, G_MAIN)
  lgRight.addColorStop(1,   G_DARK)
  ctx.fillStyle = lgRight
  ctx.fill()

  // ── rachis / central stem ──────────────────────────────────────
  // Thin tapered line from tip down to base, drawn on top of both vanes.
  ctx.beginPath()
  ctx.moveTo(w * 0.50, h * 0.04)
  ctx.lineTo(w * 0.50, h * 0.92)
  ctx.strokeStyle = 'rgba(0,0,0,0.18)'
  ctx.lineWidth   = w * 0.028
  ctx.lineCap     = 'round'
  ctx.stroke()

  // Lighter centre highlight on the stem
  ctx.beginPath()
  ctx.moveTo(w * 0.50, h * 0.06)
  ctx.lineTo(w * 0.50, h * 0.70)
  ctx.strokeStyle = 'rgba(255,255,255,0.22)'
  ctx.lineWidth   = w * 0.012
  ctx.stroke()

  // ── base notch (split quill) ───────────────────────────────────
  // A small dark wedge cut into the base to suggest a split quill.
  ctx.beginPath()
  ctx.moveTo(w * 0.50, h * 1.00)
  ctx.lineTo(w * 0.42, h * 0.88)
  ctx.lineTo(w * 0.50, h * 0.92)
  ctx.lineTo(w * 0.58, h * 0.88)
  ctx.closePath()
  ctx.fillStyle = 'rgba(0,0,0,0.30)'
  ctx.fill()

  // ── soft edge highlight at tip ────────────────────────────────
  ctx.beginPath()
  ctx.arc(w * 0.50, h * 0.05, w * 0.04, 0, Math.PI * 2)
  ctx.fillStyle = G_LIGHT
  ctx.fill()
}
