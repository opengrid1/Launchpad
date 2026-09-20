import { useMemo, useState } from "react";
import type { Address } from "viem";

import type { QuoteView } from "../lib/client";
import { usd } from "../lib/format";
import { isTokenPair } from "../lib/stocks";
import { Icon } from "./Icon";

type Group = "all" | "eth" | "token" | "stock";

/** Pick the pair asset: a grid of options grouped ETH / tokens / stocks, with search. */
export function PairPicker({ pairs, value, onChange }: { pairs: QuoteView[]; value: Address; onChange: (a: Address) => void }) {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<Group>("all");
  const kindOf = (p: QuoteView): Group => (p.isNative ? "eth" : isTokenPair(p.address) ? "token" : "stock");
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return pairs
      .filter((p) => p.approved && (group === "all" || kindOf(p) === group) && (!s || `${p.symbol} ${p.name}`.toLowerCase().includes(s)))
      .sort((a, b) => (a.isNative ? -1 : b.isNative ? 1 : kindOf(a) === kindOf(b) ? Number(b.ethRoute) - Number(a.ethRoute) || b.liqUsd - a.liqUsd : kindOf(a) === "token" ? -1 : 1));
  }, [pairs, q, group]);
  const counts = { token: pairs.filter((p) => p.approved && kindOf(p) === "token").length, stock: pairs.filter((p) => p.approved && kindOf(p) === "stock").length };
  return (
    <div className="picker">
      <div className="groups seg">
        <button type="button" className={group === "all" ? "on" : ""} onClick={() => setGroup("all")}>All</button>
        <button type="button" className={group === "eth" ? "on" : ""} onClick={() => setGroup("eth")}>ETH</button>
        <button type="button" className={group === "token" ? "on" : ""} onClick={() => setGroup("token")}>Tokens · {counts.token}</button>
        <button type="button" className={group === "stock" ? "on" : ""} onClick={() => setGroup("stock")}>Stocks · {counts.stock}</button>
      </div>
      <label className="search"><Icon name="search" size={16} /><input placeholder="Search UNI, PEPE, NVDA, Tesla…" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      <div className="grid" role="listbox">
        {list.length === 0 && <div className="empty" style={{ gridColumn: "1/-1" }}>No pair matches.</div>}
        {list.map((p) => {
          const on = p.address.toLowerCase() === value.toLowerCase();
          return (
            <button type="button" key={p.address} role="option" aria-selected={on} className={"opt " + (on ? "on" : "")} onClick={() => onChange(p.address)}>
              <b>{p.symbol}</b>
              <small>{p.isNative ? "Native · buyers pay ETH" : p.ethRoute ? p.name : `${p.name} · no ETH route`}</small>
              <span className="px">{p.usd > 0 ? usd(p.usd, { compact: p.usd >= 10_000 }) : "—"}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
