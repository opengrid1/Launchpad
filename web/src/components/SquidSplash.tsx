import { useEffect, useRef, useState } from "react";

import { BRAND, BRAND_FLAVOR } from "../lib/brand";
import { BRAND_MARK } from "../lib/hyper/defaultLogo";

// Wordmark halves, accent on the suffix.
const [WM_A, WM_B] =
  BRAND_FLAVOR === "meow" ? ["meow", "stock"] : ["squid", "pad"];

/**
 * Boot splash: the brand mark and wordmark over a game-style loading bar — a
 * glowing striped fill that sweeps as it progresses, no text. It fills, then
 * the whole splash fades out to reveal the app. Shown once per full load.
 */
export function SquidSplash() {
  const [pct, setPct] = useState(0);
  const [hide, setHide] = useState(false);
  const [done, setDone] = useState(false);
  const raf = useRef(0);

  useEffect(() => {
    const DUR = 1650;
    const start = performance.now();
    const tick = (t: number) => {
      const e = Math.min(1, (t - start) / DUR);
      const eased = 1 - Math.pow(1 - e, 2.2); // fast then easing into full
      setPct(eased * 100);
      if (e < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    const t1 = window.setTimeout(() => setHide(true), 1900);
    const t2 = window.setTimeout(() => setDone(true), 2360);
    return () => {
      cancelAnimationFrame(raf.current);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);

  if (done) return null;
  return (
    <div className={`sq-splash${hide ? " out" : ""}`} role="status" aria-label={`Loading ${BRAND.name}`}>
      <div className="sq-splash-mark"><img src={BRAND_MARK} alt="" aria-hidden /></div>
      <div className="sq-splash-lift">
        <div className="sq-splash-word">{WM_A}<b>{WM_B}</b></div>
        <div className="sq-splash-rule"><span /><span /></div>
      </div>
      <div className="sq-splash-tag">{BRAND.tagline}</div>
      <div className="sq-splash-bar"><span style={{ width: `${pct}%` }} /></div>
    </div>
  );
}
