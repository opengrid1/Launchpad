/** Pictures for the cards. Coin icons come from the contract as data URIs,
 *  often SVG or WebP, which Telegram will not take as a photo; sharp turns
 *  them into square PNGs. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

import { ROOT } from "./config.js";

export const LOGO = readFileSync(join(ROOT, "assets", "logo.png"));
const DEFAULT = readFileSync(join(ROOT, "assets", "default.png"));

const cache = new Map<string, Buffer>();

/** A 512px PNG of the coin's icon, or the default art when it has none or
 *  the icon cannot be rendered. Cached by content. */
export async function coinImage(icon: string | null | undefined): Promise<Buffer> {
  if (!icon) return DEFAULT;
  const key = createHash("sha1").update(icon).digest("hex");
  const hit = cache.get(key);
  if (hit) return hit;
  let out = DEFAULT;
  try {
    const m = icon.match(/^data:([^;,]+)(;base64)?,(.*)$/s);
    const raw = m ? (m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]), "utf8")) : Buffer.from(await (await fetch(icon, { signal: AbortSignal.timeout(8000) })).arrayBuffer());
    out = await sharp(raw, { density: 300 })
      .resize(512, 512, { fit: "contain", background: { r: 12, g: 12, b: 18, alpha: 1 } })
      .flatten({ background: { r: 12, g: 12, b: 18 } })
      .png()
      .toBuffer();
  } catch { /* fall back to the default art */ }
  if (cache.size > 200) cache.clear();
  cache.set(key, out);
  return out;
}
