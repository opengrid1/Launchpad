import { useEffect, useState } from "react";

import { BRAND, BRAND_FLAVOR } from "../lib/brand";
import { BRAND_MARK } from "../lib/hyper/defaultLogo";

// Wordmark halves, accent on the suffix.
const [WM_A, WM_B] =
  BRAND_FLAVOR === "meow" ? ["meow", "stock"] : ["squid", "pad"];

/**
 * squidpad boot splash: a deep-teal screen with the floating squid mark, the
 * wordmark, and a teal loading bar that fills, then fades out to reveal the
 * app. Shown once per full page load (App mounts once; SPA navigation does not
 * remount it), so it greets on entry without nagging between pages.
 */
export function SquidSplash() {
  const [hide, setHide] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Let the bar animation play, then fade the overlay and unmount it.
    const t1 = window.setTimeout(() => setHide(true), 1500);
    const t2 = window.setTimeout(() => setDone(true), 1980);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
  }, []);

  if (done) return null;
  return (
    <div className={`sq-splash${hide ? " out" : ""}`} role="status" aria-label="Loading squidpad">
      <div className="sq-splash-mark"><img src={BRAND_MARK} alt="" aria-hidden /></div>
      <div className="sq-splash-word">{WM_A}<b>{WM_B}</b></div>
      <div className="sq-splash-tag">{BRAND.tagline}</div>
      <div className="sq-splash-bar"><span /></div>
    </div>
  );
}
