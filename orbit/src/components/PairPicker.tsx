import { useEffect, useMemo, useRef, useState } from "react";
import type { Address } from "viem";

import { usd } from "../lib/format";
import type { QuoteView } from "../lib/onair";
import { stockByAddress } from "../lib/stocks";
import { Icon } from "./Icon";

/** Stocks with a real Hyperliquid Core spot market today (24h volume over
 *  $1k in the last scan), by address. They lead the list; the rest are thin. */
const LIQUID = new Set([
  "0x499e347174f237ad28687b947b94c0d49570d1b7", // QQQd
  "0x08be08c37d93e689518ced744a89f113b4afaad4", // GLDd
  "0xc304a9d52cf9165024ebc7814250ef3a5013f924", // HOODd
  "0x5a9d2deee7d8782011695623f1c453f46b2b566e", // METAd
  "0xe8c8afdf7e80be51e91afa28b6ac44404d270b5d", // SPCXd
  "0x173c83a71c1a9e254721a86b7512cd65bf92648d", // MUd
]);
const liquid = (p: QuoteView) => LIQUID.has(p.address.toLowerCase());

/** Pick the pair asset for an instant launch: HYPE or a tokenized stock. A
 *  styled panel (dropdown on desktop, sheet on phones) with search, instead
 *  of the OS-native select. */
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
    const hit = (p: QuoteView) => !s || `${p.symbol} ${p.name} ${stockByAddress(p.address)?.symbol ?? ""} ${stockByAddress(p.address)?.issuer ?? ""}`.toLowerCase().includes(s);
    const list = pairs.filter(hit);
    return [
      { title: "Native", items: list.filter((p) => p.isNative) },
      { title: "Trades on Hyperliquid spot", items: list.filter((p) => !p.isNative && liquid(p)) },
      { title: "Listed · thin or no market yet", items: list.filter((p) => !p.isNative && !liquid(p)) },
    ].filter((g) => g.items.length > 0);
  }, [pairs, q]);

  const pick = (a: Address) => { onChange(a); setOpen(false); setQ(""); };
  const label = (p: QuoteView) => (p.isNative ? "HYPE" : p.symbol);
  const sub = (p: QuoteView) => (p.isNative ? "Native · every auction pairs this" : `${p.name}${stockByAddress(p.address)?.issuer ? ` · ${stockByAddress(p.address)!.issuer}` : ""}`);

  const panel = (
    <div className="pp-panel">
      <div className="pp-search"><Icon name="search" size={16} /><input autoFocus placeholder="Search QQQ, Tesla, Ondo…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="pp-list">
        {groups.length === 0 && <div className="pp-empty">No pair matches "{q}".</div>}
        {groups.map((g) => (
          <div key={g.title}>
            <div className="pp-group">{g.title}</div>
            {g.items.map((p) => (
              <button type="button" key={p.address} className={"pp-row " + (p.address.toLowerCase() === current?.address.toLowerCase() ? "on" : "")} onClick={() => pick(p.address)}>
                <span className="pp-sym">{label(p)}</span>
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
        <span className="pp-sym">{current ? label(current) : "…"}</span>
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
