import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { Art } from "../components/Art";
import { DEPLOYED, FEES, isHidden, isPinned } from "../lib/env";
import { ago, num, pct, usd, wei } from "../lib/format";
import { useTokens, type Token } from "../lib/hooks";

type Sort = "new" | "mcap" | "vol" | "chg" | "paid" | "holders";
const SORTS: { k: Sort; l: string; d: string; hint: string }[] = [
  { k: "new", l: "Newest", hint: "latest launches first", d: "M12 6v6l4 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" },
  { k: "mcap", l: "Market cap", hint: "biggest coins first", d: "M4 20V10M10 20V4M16 20v-7M22 20H2" },
  { k: "vol", l: "Volume", hint: "most traded today", d: "M3 17l5-5 4 4 5-6 4 3M3 21h18" },
  { k: "chg", l: "24h change", hint: "top movers first", d: "M3 17l6-6 4 4 8-8M15 7h6v6" },
  { k: "paid", l: "Paid to creator", hint: "most fees earned", d: "M12 2v20M17 6.5c-1-1.5-2.5-2-5-2s-4.5 1.2-4.5 3.2c0 4.8 9.5 2 9.5 7 0 2-2 3.3-5 3.3s-4.5-.8-5.5-2.5" },
  { k: "holders", l: "Holders", hint: "widest ownership", d: "M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM21 21v-2a4 4 0 0 0-3-3.9M15 3.1a4 4 0 0 1 0 7.8" },
];
const SortIcon = ({ d }: { d: string }) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;

const paidUsd = (t: Token) => (t.rewards ? wei(t.rewards.creator) * t.pair.usd : 0);

export default function Home() {
  const { data: all, isLoading } = useTokens();
  const tokens = useMemo(() => all?.filter((t) => !isHidden(t.address)), [all]);
  const [sort, setSort] = useState<Sort>("new");
  const [q, setQ] = useState("");

  const key = (t: Token): number => {
    switch (sort) {
      case "mcap": return Number(t.marketCapUsd);
      case "vol": return wei(t.volume24hWei) * t.pair.usd;
      case "chg": return t.priceChange24hPct ?? -1e9;
      case "paid": return paidUsd(t);
      case "holders": return t.holderCount ?? 0;
      default: return t.createdAt;
    }
  };
  const list = useMemo(() => {
    let l = (tokens ?? []).slice();
    const s = q.trim().toLowerCase();
    if (s) l = l.filter((t) => `${t.name} ${t.symbol} ${t.address} ${t.pair.symbol}`.toLowerCase().includes(s));
    l.sort((a, b) => key(b) - key(a));
    // Official coins stay on top whatever the sort.
    l.sort((a, b) => Number(isPinned(b.address)) - Number(isPinned(a.address)));
    return l;
  }, [tokens, q, sort]);
  const totals = useMemo(() => {
    const t = tokens ?? [];
    return { n: t.length, vol: t.reduce((s, x) => s + wei(x.volume24hWei) * x.pair.usd, 0), paid: t.reduce((s, x) => s + paidUsd(x), 0) };
  }, [tokens]);

  return (
    <main className="page">
      <section className="lead">
        <div className="say">
          <h1>Coins priced in <em>dollars</em>.</h1>
          <p>Launch a coin on Arc, Circle's dollar chain. Every coin trades against USDC in a real Uniswap pool, so the price, the fees and your payout are in dollars from the first trade. The {FEES.taxPct}% pool fee pays the creator {FEES.creatorPct}% and the platform {FEES.platformPct}%.</p>
          <div className="cta"><Link to="/launch" className="btn acc">Launch a coin</Link><Link to="/docs" className="btn">How it works</Link></div>
        </div>
        <div className="stats">
          <div className="acc"><b>{num(totals.n, 0)}</b><span>coins live</span></div>
          <div><b>{usd(totals.vol, { compact: true })}</b><span>volume 24h</span></div>
          <div><b>{usd(totals.paid, { compact: true })}</b><span>paid to creators</span></div>
        </div>
      </section>

      {!DEPLOYED ? (
        <section className="sec"><div className="panel"><div className="empty">The factory is not on Arc yet. Check back shortly.</div></div></section>
      ) : (
        <section className="sec">
          <div className="sec-h">
            <div className="tools">
              <SortMenu value={sort} onChange={setSort} />
            </div>
            <input className="inp search" placeholder="Search name or ticker" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {isLoading && !tokens ? (
            <div className="grid">{[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 230 }} />)}</div>
          ) : (
            list.length === 0 ? (
              <div className="panel"><div className="empty">{q ? "Nothing matches." : "No coins yet."}</div></div>
            ) : (
              <div className="grid">
                {list.map((t, i) => <Tile key={t.address} t={t} i={i} />)}
              </div>
            )
          )}
        </section>
      )}
    </main>
  );
}

/** Sort picker: one button that opens a floating list of the sort keys. */
function SortMenu({ value, onChange }: { value: Sort; onChange: (s: Sort) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent | TouchEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", off); document.addEventListener("touchstart", off); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("touchstart", off); document.removeEventListener("keydown", esc); };
  }, [open]);
  const cur = SORTS.find((s) => s.k === value) ?? SORTS[0];
  return (
    <div className={"sortmenu" + (open ? " open" : "")} ref={ref}>
      <button type="button" className="sortmenu-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <SortIcon d={cur.d} /><span className="v">{cur.l}</span><span className="chev" aria-hidden />
      </button>
      {open && (
        <ul className="sortmenu-list" role="listbox">
          <li className="sortmenu-h">Sort coins by</li>
          {SORTS.map((s) => (
            <li key={s.k} role="option" aria-selected={s.k === value} className={s.k === value ? "on" : ""} onClick={() => { onChange(s.k); setOpen(false); }}>
              <span className="ic"><SortIcon d={s.d} /></span>
              <span className="tx"><b>{s.l}</b><small>{s.hint}</small></span>
              {s.k === value && <svg className="ck" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Tile({ t, i = 0 }: { t: Token; i?: number }) {
  const c = t.priceChange24hPct;
  const pinned = isPinned(t.address);
  return (
    <Link to={`/t/${t.address}`} className={"tile" + (pinned ? " pinned" : "")} style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}>
      <div className="tile-top">
        <Art src={t.metadata?.logo} name={t.name} className="tile-art" />
        <span className="stamps">
          {pinned && <span className="stamp official">Official</span>}
          <span className="stamp eth"><i />{t.pair.symbol}</span>
        </span>
      </div>
      <div className="tile-name"><b>{t.name}</b><span>{t.symbol}</span></div>
      <div className="tile-cap">
        <div><span className="k">Market cap</span><span className="v">{usd(t.marketCapUsd, { compact: true })}</span></div>
        <span className={"chg " + (c == null ? "" : c >= 0 ? "up" : "down")}>{c == null ? "new" : pct(c)}</span>
      </div>
      <div className="tile-meta">
        <span><b>{usd(wei(t.volume24hWei) * t.pair.usd, { compact: true })}</b>vol</span>
        <span><b>{num(t.holderCount, 0)}</b>holders</span>
        <span><b>{usd(paidUsd(t), { compact: true })}</b>to creator</span>
        <span>{ago(t.createdAt)}</span>
      </div>
    </Link>
  );
}
