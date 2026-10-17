import { FEES } from "../lib/env";

/** The fee split as one bar: holders / creator / platform. */
export function FeeBar({ pair = "the pair asset", compact = false }: { pair?: string; compact?: boolean }) {
  return (
    <div className={"feebar " + (compact ? "compact" : "")}>
      <div className="bar">
        <span className="h" style={{ flex: FEES.holderPct }} />
        <span className="c" style={{ flex: FEES.creatorPct }} />
        <span className="p" style={{ flex: FEES.platformPct }} />
      </div>
      <div className="legend">
        <span><i className="h" />{FEES.holderPct}% holders{compact ? "" : `, in ${pair}`}</span>
        <span><i className="c" />{FEES.creatorPct}% creator</span>
        <span><i className="p" />{FEES.platformPct}% platform</span>
      </div>
    </div>
  );
}
