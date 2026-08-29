import { useEffect, useState } from "react";

import { BRAND_MARK } from "../lib/hyper/defaultLogo";

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
      <div className="sq-splash-word">squid<b>pad</b></div>
      <div className="sq-splash-tag">launch in the deep</div>
      <div className="sq-splash-bar"><span /></div>
    </div>
  );
}
