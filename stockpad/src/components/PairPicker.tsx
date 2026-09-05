import { useEffect, useMemo, useRef, useState } from "react";
import type { Address } from "viem";

import type { QuoteView } from "../lib/client";
import { usd } from "../lib/format";
import { Icon } from "./Icon";

/** Pick the pair asset for a launch: ETH or a tokenized stock. A styled panel
 *  (dropdown on desktop, sheet on phones) with search, grouped by whether ETH
 *  can be routed into the stock on-chain. */
export function PairPicker({ pairs, value, onChange, disabled, note }: { pairs: QuoteView[]; value: Address; onChange: (a: Address) => void; disabled?: boolean; note?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const current = pairs.find((p) => p.address.toLowerCase() === value.toLowerCase()) ?? pairs[0];

  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", off); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("keydown", esc); };
  }, [open]);

  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = pairs.filter((p) => p.approved && (!s || `${p.symbol} ${p.name}`.toLowerCase().includes(s)));
    return [
      { title: "Native", items: list.filter((p) => p.isNative) },
      { title: "Tradeable in ETH · has an on-chain pool", items: list.filter((p) => !p.isNative && p.ethRoute) },
      { title: "Listed · buyers must hold the stock", items: list.filter((p) => !p.isNative && !p.ethRoute) },
    ].filter((g) => g.items.length > 0);
  }, [pairs, q]);

  const pick = (a: Address) => { onChange(a); setOpen(false); setQ(""); };
  const sub = (p: QuoteView) => (p.isNative ? "Native · buyers pay ETH" : `${p.name}${p.liqUsd > 0 ? ` · ${usd(p.liqUsd, { compact: true })} pool` : " · no pool yet"}`);

  const panel = (
    <div className="pp-panel">
      <div className="pp-search"><Icon name="search" size={16} /><input autoFocus placeholder="Search NVDA, Tesla, SPY…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="pp-list">
        {groups.length === 0 && <div className="pp-empty">No pair matches "{q}".</div>}
        {groups.map((g) => (
          <div key={g.title}>
            <div className="pp-group">{g.title}</div>
            {g.items.map((p) => (
              <button type="button" key={p.address} className={"pp-row " + (p.address.toLowerCase() === current?.address.toLowerCase() ? "on" : "")} onClick={() => pick(p.address)}>
                <span className="pp-sym">{p.symbol}</span>
                <span className="pp-name">{sub(p)}</span>
                <span className="pp-px">{p.usd > 0 ? usd(p.usd, { compact: p.usd >= 10_000 }) : "—"}</span>
                {p.address.toLowerCase() === current?.address.toLowerCase() && <Icon name="check" size={16} />}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="pp" ref={box}>
      <button type="button" className={"pp-trigger " + (open ? "open" : "")} disabled={disabled} onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open}>
        <span className="pp-sym">{current ? current.symbol : "…"}</span>
        <span className="pp-name">{current ? sub(current) : "Loading pairs"}</span>
        {current && current.usd > 0 && <span className="pp-px">{usd(current.usd, { compact: current.usd >= 10_000 })}</span>}
        {!disabled && <span className="pp-caret" />}
      </button>
      {note && <div className="help">{note}</div>}
      {open && !disabled && (
        <>
          <div className="pp-desk">{panel}</div>
          <div className="scrim pp-scrim" onClick={() => setOpen(false)} />
          <div className="sheet pp-sheet"><div className="grab" />{panel}</div>
        </>
      )}
    </div>
  );
}
