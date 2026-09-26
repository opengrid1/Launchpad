import { useEffect, useMemo, useState } from "react";
import { isAddress, type Address } from "viem";

import { client, type PairPreview, type QuoteView } from "../lib/client";
import { num, usd, wei } from "../lib/format";
import { isTokenPair } from "../lib/stocks";

type Group = "all" | "eth" | "token" | "stock";

/** Pick the pair asset: a searchable list of known pairs, or paste any ERC-20
 *  address and the registry checks whether it can price and route it. */
export function PairPicker({ pairs, value, onChange }: { pairs: QuoteView[]; value: Address; onChange: (a: Address, custom?: PairPreview) => void }) {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<Group>("all");
  const [preview, setPreview] = useState<PairPreview | null>(null);
  const [checking, setChecking] = useState(false);
  const kindOf = (p: { isNative: boolean; address: string; v3Fee?: number }): Group | "any" => (p.isNative ? "eth" : isTokenPair(p.address) ? "token" : p.v3Fee ? "any" : "stock");
  const pasted = isAddress(q.trim()) ? (q.trim().toLowerCase() as Address) : null;
  const known = pasted ? pairs.find((p) => p.address.toLowerCase() === pasted) : undefined;

  useEffect(() => {
    if (!pasted || known) { setPreview(null); return; }
    let live = true;
    setChecking(true);
    client.previewPair(pasted).then((pv) => { if (live) setPreview(pv); }).catch(() => { if (live) setPreview(null); }).finally(() => { if (live) setChecking(false); });
    return () => { live = false; };
  }, [pasted, known]);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return pairs
      .filter((p) => p.approved && (group === "all" || kindOf(p) === group || (group === "token" && kindOf(p) === "any")) && (!s || `${p.symbol} ${p.name} ${p.address}`.toLowerCase().includes(s)))
      .sort((a, b) => (a.isNative ? -1 : b.isNative ? 1 : kindOf(a) === kindOf(b) ? Number(b.ethRoute) - Number(a.ethRoute) || b.liqUsd - a.liqUsd : kindOf(a) !== "stock" ? -1 : 1));
  }, [pairs, q, group]);
  const counts = { token: pairs.filter((p) => p.approved && kindOf(p) !== "stock" && !p.isNative).length, stock: pairs.filter((p) => p.approved && kindOf(p) === "stock").length };
  const on = (a: string) => a.toLowerCase() === value.toLowerCase();

  return (
    <div className="picker">
      <div className="top">
        <input className="in" placeholder="Search UNI, PEPE, NVDA… or paste any token address" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="seg">
          <button type="button" className={group === "all" ? "on" : ""} onClick={() => setGroup("all")}>All</button>
          <button type="button" className={group === "eth" ? "on" : ""} onClick={() => setGroup("eth")}>ETH</button>
          <button type="button" className={group === "token" ? "on" : ""} onClick={() => setGroup("token")}>Tokens ({counts.token})</button>
          <button type="button" className={group === "stock" ? "on" : ""} onClick={() => setGroup("stock")}>Stocks ({counts.stock})</button>
        </div>
      </div>
      <div className="list" role="listbox">
        {pasted && !known && (checking ? <div className="empty">Checking the token on Uniswap…</div> : preview ? (
          preview.ok ? (
            <button type="button" role="option" aria-selected={on(preview.address)} className={"opt " + (on(preview.address) ? "on" : "")} onClick={() => onChange(preview.address, preview)}>
              <span className="av any">{preview.symbol.slice(0, 4) || "?"}</span>
              <span><b>{preview.symbol || "Token"}</b><small>{preview.name || preview.address}{preview.approved ? " · registered" : ` · registers at launch from its ${(preview.v3Fee ?? 0) / 10_000}% Uniswap pool, ${num(wei(preview.poolWeth), 1)} WETH deep`}</small></span>
              <span className="px">{preview.usd > 0 ? usd(preview.usd, { compact: preview.usd >= 10_000 }) : "—"}</span>
            </button>
          ) : <div className="empty">{preview.symbol ? `${preview.symbol} cannot be a pair asset. ` : ""}{preview.reason}</div>
        ) : null)}
        {list.length === 0 && !pasted && <div className="empty">No pair matches. Paste a token address to use any ERC-20.</div>}
        {list.map((p) => {
          const k = kindOf(p);
          return (
            <button type="button" key={p.address} role="option" aria-selected={on(p.address)} className={"opt " + (on(p.address) ? "on" : "")} onClick={() => onChange(p.address)}>
              <span className={"av " + (k === "any" ? "token" : k)}>{p.symbol.replace(/on$/, "").slice(0, 4)}</span>
              <span><b>{p.symbol}</b><small>{p.isNative ? "Native · buyers pay ETH" : p.ethRoute ? p.name || p.address : `${p.name} · no ETH route`}</small></span>
              <span className="px">{p.usd > 0 ? usd(p.usd, { compact: p.usd >= 10_000 }) : "—"}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
