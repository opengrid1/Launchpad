import { useEffect, useRef } from 'react'

export function ARCFeather({ size = 48 }: { size?: number }) {
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
  const cx = s / 2
  const cy = s / 2
  const r  = s * 0.42

  // Outer ring
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  const ringGrad = ctx.createLinearGradient(0, 0, s, s)
  ringGrad.addColorStop(0,   '#8b84ff')
  ringGrad.addColorStop(1,   '#4f46e5')
  ctx.strokeStyle = ringGrad
  ctx.lineWidth   = s * 0.07
  ctx.stroke()

  // Inner "A" arc — top half arc suggesting the letter A / arc shape
  ctx.beginPath()
  ctx.arc(cx, cy + s * 0.06, r * 0.55, Math.PI * 1.15, Math.PI * 1.85, false)
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth   = s * 0.09
  ctx.lineCap     = 'round'
  ctx.stroke()

  // Cross bar of the A
  const barY  = cy + s * 0.15
  const barX1 = cx - r * 0.26
  const barX2 = cx + r * 0.26
  ctx.beginPath()
  ctx.moveTo(barX1, barY)
  ctx.lineTo(barX2, barY)
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth   = s * 0.07
  ctx.lineCap     = 'round'
  ctx.stroke()
}
