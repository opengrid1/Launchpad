import type { Split } from "../lib/types";

/** Where the tax goes: the platform's fifth, then the creator's four shares of the rest. */
export function SplitBar({ split, taxPct, compact = false }: { split: Split; taxPct?: number; compact?: boolean }) {
  const parts = [
    { k: "Creator", v: split.creator_bps, c: "var(--gold)" },
    { k: "Dividends", v: split.dividends_bps, c: "var(--accent)" },
    { k: "Buyback and burn", v: split.burn_bps, c: "var(--down)" },
    { k: "Liquidity", v: split.liquidity_bps, c: "var(--violet)" },
  ];
  return (
    <div className={"splitbar" + (compact ? " compact" : "")}>
      {taxPct != null && <div className="sb-t">{taxPct}% of every trade · platform keeps 20%, the creator divides the rest</div>}
      <div className="sb-bar">
        <span style={{ width: "20%", background: "var(--line2)" }} title="Platform 20%" />
        {parts.filter((p) => p.v > 0).map((p) => <span key={p.k} style={{ width: `${(p.v / 10000) * 80}%`, background: p.c }} title={`${p.k} ${p.v / 100}%`} />)}
      </div>
      {!compact && (
        <div className="sb-legend">
          <span><i style={{ background: "var(--line2)" }} />Platform 20%</span>
          {parts.map((p) => <span key={p.k} className={p.v === 0 ? "faint" : ""}><i style={{ background: p.c }} />{p.k} {p.v / 100}%</span>)}
        </div>
      )}
    </div>
  );
}
