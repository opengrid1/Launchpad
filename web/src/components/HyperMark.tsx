/** Chain badge on token avatars: the official chain mark, circle-cropped.
 *  hyperstock + meowstock show Hyperliquid's (HyperEVM) mark; squidpad shows a
 *  teal ink-drop badge for Ink (all teal, no purple). */
import { BRAND_FLAVOR } from "../lib/brand";

// A teal disc with a lighter-teal ink drop, drawn inline so it needs no asset.
const INK_TEAL_MARK =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'>` +
      `<circle cx='20' cy='20' r='20' fill='#0f766e'/>` +
      `<path d='M20 9 C25 16 28 20 28 24 A8 8 0 0 1 12 24 C12 20 15 16 20 9 Z' fill='#4fe0cb'/>` +
      `</svg>`,
  );

export function HyperMark() {
  return (
    <img
      src={BRAND_FLAVOR === "ink" || BRAND_FLAVOR === "robinhood" ? INK_TEAL_MARK : "/hyperliquid-mark.png"}
      alt=""
      aria-hidden
      style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover", display: "block" }}
    />
  );
}
