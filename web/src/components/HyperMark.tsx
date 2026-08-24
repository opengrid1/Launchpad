/** Hyperliquid chain badge: the official Hyperliquid mark (dark green tile,
 *  mint wave glyph), circle-cropped to sit as a chain badge on token avatars
 *  and wallet rows in place of the Base disc. */
export function HyperMark() {
  return (
    <img
      src="/hyperliquid-mark.png"
      alt=""
      aria-hidden
      style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover", display: "block" }}
    />
  );
}
