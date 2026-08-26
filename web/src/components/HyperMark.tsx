/** Chain badge on token avatars: the official chain mark, circle-cropped.
 *  hyperstock shows Hyperliquid's mark; squidpad shows Ink's. */
import { IS_INK } from "../lib/brand";

export function HyperMark() {
  return (
    <img
      src={IS_INK ? "/ink-mark.png" : "/hyperliquid-mark.png"}
      alt=""
      aria-hidden
      style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover", display: "block" }}
    />
  );
}
