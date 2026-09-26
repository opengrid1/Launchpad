import { IS_HYPER } from "../lib/brand";
import { env } from "../lib/env";

/**
 * koi.fun marquee ticker — the light band above the header. On basedstonk it
 * carries the "hold & earn" rewards message; on hyperstock (hyper) coins have
 * no holder rewards, so it carries the creator-fee message instead.
 */
export function BaseTicker() {
  const item = IS_HYPER ? (
    <span className="kf-tick">
      <span aria-hidden style={{ width: 9, height: 9, borderRadius: 999, background: "var(--color-accent)", boxShadow: "0 0 8px var(--color-accent)", display: "inline-block" }} />
      <b>Launch. Earn the fees.</b>
      <span>every trade pays the creator 1% forever · on {env.chainName}</span>
    </span>
  ) : (
    <span className="kf-tick">
      <img
        src="/stonk-logo.jpg"
        alt=""
        aria-hidden
        style={{ width: 20, height: 20, borderRadius: 6, objectFit: "cover" }}
      />
      <b>Hold &amp; earn</b>
      <span>rewards stream to holders in real time</span>
    </span>
  );

  return (
    <div className="kf-ticker" aria-label={IS_HYPER ? "Launch a coin, earn the fees" : "Rewards stream to holders in real time"}>
      <div className="kf-ticker-track" aria-hidden>
        {[...Array(8)].map((_, i) => <span key={i} style={{ display: "inline-flex" }}>{item}</span>)}
      </div>
    </div>
  );
}
