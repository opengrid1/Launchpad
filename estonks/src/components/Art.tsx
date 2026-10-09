import { useState } from "react";

import { isMain } from "../lib/env";

/** Coin artwork in a chip: the creator's image, the E mark for the main token,
 *  else the default pixel coin. */
export function Art({ src, address, size = "" }: { src?: string; address?: string; size?: "" | "sm" | "lg" | "xl" }) {
  const [bad, setBad] = useState(false);
  const main = !!address && isMain(address);
  const img = main ? "/icon.svg" : src && !bad ? src : "/default-coin.png";
  return (
    <span className={`chip ${size} ${!src || bad ? "def" : ""}`}>
      <img src={img} alt="" loading="lazy" onError={() => setBad(true)} />
    </span>
  );
}
