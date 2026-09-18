import { useMemo, useState } from "react";
import type { Address } from "viem";

import type { QuoteView } from "../lib/client";
import { usd } from "../lib/format";
import { Icon } from "./Icon";

/** Pick the pair asset for a launch: an inline, searchable list grouped by
 *  whether ETH can be routed into the stock on-chain. Always visible; the
 *  launch wizard gives it a whole step. */
export function PairPicker({ pairs, value, onChange }: { pairs: QuoteView[]; value: Address; onChange: (a: Address) => void }) {
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = pairs.filter((p) => p.approved && (!s || `${p.symbol} ${p.name}`.toLowerCase().includes(s)));
    return [
      { title: "Native", items: list.filter((p) => p.isNative) },
      { title: "Stocks tradeable in ETH · has an on-chain pool", items: list.filter((p) => !p.isNative && p.ethRoute) },
      { title: "Listed stocks · buyers must hold the stock", items: list.filter((p) => !p.isNative && !p.ethRoute) },
    ].filter((g) => g.items.length > 0);
  }, [pairs, q]);
  const sub = (p: QuoteView) => (p.isNative ? "Buyers pay ETH, fees arrive in ETH" : `${p.name}${p.liqUsd > 0 ? ` · ${usd(p.liqUsd, { compact: true })} pool` : " · no pool yet"}`);
  return (
    <div>
      <label className="pairsearch"><Icon name="search" size={16} /><input placeholder="Search NVDA, Tesla, SPY…" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      <div className="pairlist" role="listbox">
        {groups.length === 0 && <div className="empty">No pair matches "{q}".</div>}
        {groups.map((g) => (
          <div key={g.title}>
            <div className="grp lbl">{g.title}</div>
            {g.items.map((p) => {
              const on = p.address.toLowerCase() === value.toLowerCase();
              return (
                <button type="button" key={p.address} role="option" aria-selected={on} className={"pr " + (on ? "on" : "")} onClick={() => onChange(p.address)}>
                  <span className="sym">{p.symbol}</span>
                  <span className="nm">{sub(p)}</span>
                  <span className="px">{p.usd > 0 ? usd(p.usd, { compact: p.usd >= 10_000 }) : "—"}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
