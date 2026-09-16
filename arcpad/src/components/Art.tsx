import { useEffect, useRef, useState } from "react";

/** Deterministic hue set from a name, so a coin's generated art is stable. */
export function hues(name: string): [number, number, number] {
  let h = 7;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const a = h % 360;
  return [a, (a + 45 + (h % 60)) % 360, (a + 200 + (h % 90)) % 360];
}

/** Coin artwork: the creator's image when there is one, else an engraved
 *  "banknote" seal drawn on canvas from the coin's name: a warm two-tone
 *  ground, guilloche rings, and the coin's initial set in the display serif. */
export function Art({ src, name, className = "art", size }: { src?: string; name: string; className?: string; size?: number }) {
  const [bad, setBad] = useState(false);
  const ref = useRef<HTMLCanvasElement>(null);
  const style = size ? { width: size, height: size } : undefined;
  useEffect(() => {
    if ((src && !bad) || !ref.current) return;
    const c = ref.current;
    const px = 256;
    c.width = px; c.height = px;
    const ctx = c.getContext("2d")!;
    const [h1, h2] = hues(name);
    // ground: a soft diagonal wash between two warm, desaturated hues
    const g = ctx.createLinearGradient(0, 0, px, px);
    g.addColorStop(0, `hsl(${h1} 38% 88%)`);
    g.addColorStop(1, `hsl(${h2} 34% 76%)`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, px, px);
    // guilloche: concentric fine rings, slightly offset, like an engraved seal
    ctx.strokeStyle = `hsl(${h1} 30% 30% / 0.16)`; ctx.lineWidth = 1;
    for (let r = 22; r < px * 0.72; r += 9) { ctx.beginPath(); ctx.arc(px * 0.5, px * 0.5, r, 0, Math.PI * 2); ctx.stroke(); }
    ctx.strokeStyle = `hsl(${h2} 30% 30% / 0.10)`;
    for (let r = 26; r < px * 0.72; r += 9) { ctx.beginPath(); ctx.arc(px * 0.54, px * 0.46, r, 0, Math.PI * 2); ctx.stroke(); }
    // the medallion
    ctx.fillStyle = `hsl(${h1} 26% 14%)`;
    ctx.beginPath(); ctx.arc(px * 0.5, px * 0.5, px * 0.31, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(px * 0.5, px * 0.5, px * 0.27, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,.22)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(px * 0.5, px * 0.5, px * 0.335, 0, Math.PI * 2); ctx.stroke();
    // the initial, set in the display serif
    const letter = (name.trim().match(/[A-Za-z0-9]/)?.[0] ?? "$").toUpperCase();
    ctx.fillStyle = `hsl(${h1} 40% 92%)`;
    ctx.font = `italic ${Math.round(px * 0.34)}px "Instrument Serif", "Times New Roman", Georgia, serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(letter, px * 0.5, px * 0.52);
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
