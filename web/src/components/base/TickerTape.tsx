import { BASE_STOCKS } from "../../lib/base/stocks";

/** Display ticker without the tokenized-"c" suffix: NVDAc -> NVDA. */
const disp = (sym: string) => sym.replace(/^wt/, "").replace(/c$/, "");

/**
 * Scrolling exchange ticker tape of the reward stocks — the signature strip of
 * the stonkpad "coin exchange" identity. Pure-CSS marquee; duplicated once so
 * the loop is seamless. The little up/down arrow is decorative (snapshot
 * prices), signalling "these are the stocks your holders earn".
 */
export function TickerTape() {
  const row = [...BASE_STOCKS, ...BASE_STOCKS];
  return (
    <div className="sx-ticker" role="marquee" aria-label="Reward stocks">
      <div className="sx-ticker-track">
        {row.map((s, i) => {
          const up = (i % 3) !== 0; // decorative alternation
          return (
            <span className="sx-tick" key={`${s.symbol}-${i}`}>
              <b className="sx-tick-sym">{disp(s.symbol)}</b>
              <span className="sx-tick-px">${s.usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              <span className={up ? "sx-tick-up" : "sx-tick-dn"}>{up ? "▲" : "▼"}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
