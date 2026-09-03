import { useEffect, useRef } from "react";

import { hues } from "./Art";

export interface Body { name: string; src?: string }

/** Hero visual: the launched coins orbit a bright core on tilted rings.
 *  Canvas, ~60fps, pauses when off-screen or when motion is reduced. */
export function OrbitScene({ bodies }: { bodies: Body[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const imgs = bodies.slice(0, 9).map((b) => {
      if (!b.src) return null;
      const im = new Image(); im.src = b.src; return im;
    });
    const list = bodies.slice(0, 9);
    let raf = 0, t = 0, visible = true, w = 0, h = 0, dpr = 1;
    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) loop(); }); io.observe(canvas);

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.46;
      // core glow
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.6);
      g.addColorStop(0, "rgba(41,151,255,.55)"); g.addColorStop(0.4, "rgba(41,151,255,.12)"); g.addColorStop(1, "rgba(41,151,255,0)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(cx, cy, R * 0.06, 0, Math.PI * 2); ctx.fill();
      // rings
      const rings = [0.42, 0.68, 0.95];
      rings.forEach((k, ri) => {
        const rx = R * k, ry = R * k * 0.36, tilt = -0.42 + ri * 0.12;
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(tilt);
        ctx.strokeStyle = "rgba(255,255,255,.14)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      });
      // bodies, painter-sorted by depth so near ones overlap far ones
      const items = list.map((b, i) => {
        const ri = i % rings.length, k = rings[ri];
        const rx = R * k, ry = R * k * 0.36, tilt = -0.42 + ri * 0.12;
        const speed = (0.25 - ri * 0.06) * (reduce ? 0 : 1);
        const a = t * speed + (i * Math.PI * 2) / Math.max(1, list.length) * 1.7;
        const ex = Math.cos(a) * rx, ey = Math.sin(a) * ry;
        const x = cx + ex * Math.cos(tilt) - ey * Math.sin(tilt);
        const y = cy + ex * Math.sin(tilt) + ey * Math.cos(tilt);
        const depth = (Math.sin(a) + 1) / 2; // 0 far, 1 near
        return { b, i, x, y, depth, size: R * (0.075 + depth * 0.05) };
      }).sort((p, q) => p.depth - q.depth);
      for (const it of items) {
        const r = it.size;
        ctx.save();
        ctx.globalAlpha = 0.55 + it.depth * 0.45;
        ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6;
        ctx.beginPath(); ctx.arc(it.x, it.y, r, 0, Math.PI * 2); ctx.closePath();
        const im = imgs[it.i];
        if (im && im.complete && im.naturalWidth > 0) {
          ctx.clip(); ctx.drawImage(im, it.x - r, it.y - r, r * 2, r * 2);
        } else {
          const [h1, h2] = hues(it.b.name);
          const lg = ctx.createLinearGradient(it.x - r, it.y - r, it.x + r, it.y + r);
          lg.addColorStop(0, `hsl(${h1} 75% 62%)`); lg.addColorStop(1, `hsl(${h2} 75% 48%)`);
          ctx.fillStyle = lg; ctx.fill();
        }
        ctx.restore();
        ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(it.x, it.y, r, 0, Math.PI * 2); ctx.stroke();
      }
    };
    const loop = () => {
      draw();
      if (reduce || !visible) return;
      t += 0.016; raf = requestAnimationFrame(loop);
    };
    loop();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); };
  }, [bodies]);
  return <canvas ref={ref} className="scene" aria-hidden="true" />;
}
