import { useEffect, useRef, useState } from "react";

import { BRAND, BRAND_FLAVOR } from "../lib/brand";
import { BRAND_MARK } from "../lib/hyper/defaultLogo";

// Wordmark halves, accent on the suffix.
const [WM_A, WM_B] =
  BRAND_FLAVOR === "meow" ? ["meow", "stock"] : ["squid", "pad"];

// Game-style status lines that cycle while the bar fills.
const TIPS = ["Opening the market", "Loading coins", "Warming up the pool", "Almost there"];

/**
 * Boot splash: the brand mark and wordmark over a game-style loading bar with a
 * counting percentage, a sweeping shine, and cycling status text. It fills,
 * reaches 100%, then fades out to reveal the app. Shown once per full load.
 */
export function SquidSplash() {
  const [pct, setPct] = useState(0);
  const [tip, setTip] = useState(0);
  const [hide, setHide] = useState(false);
  const [done, setDone] = useState(false);
  const raf = useRef(0);

  useEffect(() => {
    const DUR = 1650;
    const start = performance.now();
    const tick = (t: number) => {
      const e = Math.min(1, (t - start) / DUR);
      const eased = 1 - Math.pow(1 - e, 2.2); // fast then easing into 100
      setPct(Math.round(eased * 100));
      if (e < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    const tipId = window.setInterval(() => setTip((n) => (n + 1) % TIPS.length), 470);
    const t1 = window.setTimeout(() => setHide(true), 1900);
    const t2 = window.setTimeout(() => setDone(true), 2360);
    return () => {
      cancelAnimationFrame(raf.current);
      window.clearInterval(tipId);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);

  if (done) return null;
  const status = pct >= 100 ? "Ready" : TIPS[tip];
  return (
    <div className={`sq-splash${hide ? " out" : ""}`} role="status" aria-label={`Loading ${BRAND.name}`}>
      <div className="sq-splash-mark"><img src={BRAND_MARK} alt="" aria-hidden /></div>
      <div className="sq-splash-word">{WM_A}<b>{WM_B}</b></div>
      <div className="sq-splash-tag">{BRAND.tagline}</div>
      <div className="sq-splash-bar"><span style={{ width: `${pct}%` }} /></div>
      <div className="sq-splash-meta">
        <span className="tip">{status}{pct < 100 ? "…" : ""}</span>
        <span className="pct">{pct}%</span>
      </div>
    </div>
  );
}
