import { useState } from "react";

/** Token artwork from its metadata (a data: URI set at launch), or a generated
 *  monogram tile so every coin still has a face. */
export function Logo({ src, name, className = "art", size }: { src?: string; name: string; className?: string; size?: number }) {
  const [bad, setBad] = useState(false);
  const style = size ? { width: size, height: size } : undefined;
  if (src && !bad) return <img className={className} src={src} alt="" loading="lazy" onError={() => setBad(true)} style={style} />;
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <div className={className} style={{ ...style, display: "grid", placeItems: "center", background: `linear-gradient(135deg, hsl(${hue} 70% 60%), hsl(${(hue + 40) % 360} 70% 45%))`, color: "#fff", fontWeight: 700, fontSize: size ? size * 0.42 : "2.4em", letterSpacing: "-.03em" }} aria-hidden="true">
      {name.trim().slice(0, 1).toUpperCase() || "?"}
    </div>
  );
}
