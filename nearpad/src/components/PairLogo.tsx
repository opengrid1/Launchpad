import { useState } from "react";

/** Files that are not PNG. */
const EXT: Record<string, string> = { NEAR: "svg", MRVLon: "webp" };

/** The official mark of a pair asset, on a white tile so dark marks read in
 *  both themes. Files live in public/pairs, named by the pair key. Falls
 *  back to initials when a pair has no file yet. */
export function PairLogo({ k, size = 24, className = "" }: { k: string; size?: number; className?: string }) {
  const [missing, setMissing] = useState(false);
  const src = `/pairs/${k}.${EXT[k] ?? "png"}`;
  if (missing) {
    return <span className={"plogo txt " + className} style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}>{k.slice(0, 2).toUpperCase()}</span>;
  }
  return <span className={"plogo " + className} style={{ width: size, height: size }}><img src={src} alt="" loading="lazy" onError={() => setMissing(true)} /></span>;
}
