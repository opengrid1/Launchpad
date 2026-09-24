import { useEffect, useRef, useState } from "react";

/** Deterministic hue set from a name, so a coin's generated art is stable. */
export function hues(name: string): [number, number, number] {
  let h = 7;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const a = h % 360;
  return [a, (a + 45 + (h % 60)) % 360, (a + 200 + (h % 90)) % 360];
}

/** The brand unicorn, loaded once and shared by every default artwork. */
let unicorn: HTMLImageElement | null = null;
let unicornReady: Promise<HTMLImageElement> | null = null;
const loadUnicorn = () => {
  if (!unicornReady) {
    const img = new Image();
    img.src = "/unicorn.png";
    unicornReady = img.decode().then(() => (unicorn = img));
  }
  return unicornReady;
};

/** Coin artwork: the creator's image when there is one, else the default
 *  logo: the brand unicorn on a plain dark tile. Never a letter tile. */
export function Art({ src, name, className = "art", size }: { src?: string; name: string; className?: string; size?: number }) {
  const [bad, setBad] = useState(false);
  const ref = useRef<HTMLCanvasElement>(null);
  const style = size ? { width: size, height: size } : undefined;
  useEffect(() => {
    if ((src && !bad) || !ref.current) return;
    const c = ref.current;
    const px = 256;
    let alive = true;
    const paint = () => {
      c.width = px; c.height = px;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#0A0B0D";
      ctx.fillRect(0, 0, px, px);
      if (unicorn) {
        const h = px * 0.6, w = (unicorn.width / unicorn.height) * h;
        ctx.drawImage(unicorn, (px - w) / 2, (px - h) / 2 + px * 0.01, w, h);
      }
    };
    paint();
    if (!unicorn) loadUnicorn().then(() => { if (alive) paint(); }).catch(() => {});
    return () => { alive = false; };
  }, [src, bad, name]);
  if (src && !bad) return <img className={className} src={src} alt="" loading="lazy" onError={() => setBad(true)} style={style} />;
  return <canvas ref={ref} className={className} style={style} aria-hidden="true" />;
}

/** Tiny price line for cards. */
export function Spark({ data, up, width = 96, height = 30 }: { data?: number[]; up: boolean; width?: number; height?: number }) {
  if (!data || data.length < 2) return <svg width={width} height={height} aria-hidden="true"><line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="currentColor" strokeOpacity=".18" strokeDasharray="2 3" /></svg>;
  const min = Math.min(...data), max = Math.max(...data), span = max - min || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * width, height - 2 - ((v - min) / span) * (height - 4)] as const);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const color = up ? "var(--up)" : "var(--down)";
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <defs><linearGradient id="sg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".28" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <path d={`${d} L${width},${height} L0,${height} Z`} fill="url(#sg)" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
