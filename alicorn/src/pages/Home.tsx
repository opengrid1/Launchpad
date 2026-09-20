import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { Art } from "../components/Art";
import { DEPLOYED, FEES, isHidden, isPinned } from "../lib/env";
import { ago, num, pct, usd, wei } from "../lib/format";
import { useQuotes, useTokens, type Token } from "../lib/hooks";
import { isTokenPair } from "../lib/stocks";

type Col = "new" | "price" | "chg" | "mcap" | "vol" | "holders" | "paid";
const COLS: { k: Col; l: string; cls: string }[] = [
  { k: "price", l: "Price", cls: "c-price r" }, { k: "chg", l: "24h", cls: "c-chg r" }, { k: "mcap", l: "Mcap", cls: "c-mcap r" },
  { k: "vol", l: "Vol 24h", cls: "c-vol r" }, { k: "holders", l: "Holders", cls: "c-hold r" }, { k: "paid", l: "Paid to holders", cls: "c-paid r" },
];
const paidUsd = (t: Token) => (t.rewards ? wei(t.rewards.holders) * t.pair.usd : 0);
const pairKind = (t: Token) => (t.pair.isNative ? "eth" : isTokenPair(t.pair.address) ? "token" : "stock");

/** Coins page: the pair ribbon is the hero, then one list of every coin with
 *  what it has paid its holders so far. */
export default function Home() {
  const { data: all, isLoading } = useTokens();
  const { data: quotes } = useQuotes();
  const tokens = useMemo(() => all?.filter((t) => !isHidden(t.address)), [all]);
  const [sort, setSort] = useState<Col>("new");
  const [desc, setDesc] = useState(true);
  const [q, setQ] = useState("");
  const [pair, setPair] = useState<string | null>(null);

  const key = (t: Token): number => {
    switch (sort) {
      case "price": return Number(t.priceUsd);
      case "chg": return t.priceChange24hPct ?? -1e9;
      case "mcap": return Number(t.marketCapUsd);
      case "vol": return wei(t.volume24hWei) * t.pair.usd;
      case "holders": return t.holderCount ?? 0;
      case "paid": return paidUsd(t);
      default: return t.createdAt;
    }
  };
  const list = useMemo(() => {
    let l = (tokens ?? []).slice();
    const s = q.trim().toLowerCase();
    if (s) l = l.filter((t) => `${t.name} ${t.symbol} ${t.address} ${t.pair.symbol}`.toLowerCase().includes(s));
    if (pair) l = l.filter((t) => t.pair.address.toLowerCase() === pair);
    l.sort((a, b) => (desc ? key(b) - key(a) : key(a) - key(b)));
    l.sort((a, b) => Number(isPinned(b.address)) - Number(isPinned(a.address)));
    return l;
  }, [tokens, q, pair, sort, desc]);
  const totals = useMemo(() => {
    const t = tokens ?? [];
    return { n: t.length, vol: t.reduce((s, x) => s + wei(x.volume24hWei) * x.pair.usd, 0), paid: t.reduce((s, x) => s + paidUsd(x), 0) };
  }, [tokens]);
  const maxPaid = useMemo(() => Math.max(1, ...(tokens ?? []).map(paidUsd)), [tokens]);
  // Ribbon: ETH, then token pairs, then the stocks that have a live pool, with how many coins use each.
  const ribbon = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of tokens ?? []) counts.set(t.pair.address.toLowerCase(), (counts.get(t.pair.address.toLowerCase()) ?? 0) + 1);
    const qs = (quotes ?? []).filter((x) => x.approved);
    const eth = qs.filter((x) => x.isNative);
    const toks = qs.filter((x) => !x.isNative && isTokenPair(x.address));
    const stocks = qs.filter((x) => !x.isNative && !isTokenPair(x.address) && x.ethRoute).slice(0, 8);
    return [...eth, ...toks, ...stocks].map((x) => ({ ...x, n: counts.get(x.address.toLowerCase()) ?? 0 }));
  }, [quotes, tokens]);
  const approvedCount = quotes ? quotes.filter((x) => x.approved && !x.isNative).length : 0;
  const head = (k: Col) => () => { if (sort === k) setDesc(!desc); else { setSort(k); setDesc(true); } };

  return (
    <main>
      <section className="hero">
        <div>
          <div className="eyebrow">Ethereum · Uniswap V4</div>
          <h1 style={{ marginTop: 10 }}>Pair with <span className="horn-text">anything</span>.<br />Get paid to hold.</h1>
          <p className="lead">Launch a coin against ETH, UNI, LINK, PEPE, a tokenized stock, {approvedCount > 0 ? `any of ${approvedCount} approved assets` : "any approved asset"}. Every trade pays {FEES.taxPct}%: {FEES.holderPct}% goes to holders in the pair asset the moment it happens, {FEES.creatorPct}% to the creator, {FEES.platformPct}% to the platform.</p>
          <div className="cta"><Link to="/launch" className="b horn lg">Launch a coin</Link><Link to="/docs" className="b ghost lg">How it pays</Link></div>
        </div>
        <div className="stats">
          <div className="horn"><span className="eyebrow">Paid to holders</span><b>{usd(totals.paid, { compact: true })}</b></div>
          <div><span className="eyebrow">Volume 24h</span><b>{usd(totals.vol, { compact: true })}</b></div>
          <div><span className="eyebrow">Coins</span><b>{num(totals.n, 0)}</b></div>
        </div>
      </section>

      {DEPLOYED && (
        <div className="ribbon">
          <span className="lbl">Pairs</span>
          <a href="#" className={pair === null ? "on" : ""} onClick={(e) => { e.preventDefault(); setPair(null); }}><i>ALL</i>Every pair</a>
          {ribbon.map((x) => {
            const k = x.isNative ? "eth" : isTokenPair(x.address) ? "tok" : "stk";
            const on = pair === x.address.toLowerCase();
            return <a key={x.address} href="#" className={`${k} ${on ? "on" : ""}`} onClick={(e) => { e.preventDefault(); setPair(on ? null : x.address.toLowerCase()); }}><i>{x.symbol.replace(/on$/, "").slice(0, 4)}</i>{x.symbol}<small>{x.usd > 0 ? usd(x.usd, { compact: x.usd >= 10_000 }) : ""}{x.n > 0 ? ` · ${x.n}` : ""}</small></a>;
          })}
          <Link to="/launch" className="more">+ {Math.max(0, approvedCount - ribbon.length + 1)} more in Launch</Link>
        </div>
      )}

      {!DEPLOYED ? (
        <section className="sec"><div className="list"><div className="empty">The factory is not on Ethereum yet. Check back shortly.</div></div></section>
      ) : (
        <section className="sec">
          <div className="sec-h">
            <h2>{pair ? `Coins paired with ${ribbon.find((x) => x.address.toLowerCase() === pair)?.symbol ?? "this asset"}` : "All coins"}</h2>
            <div className="tools"><input className="in" placeholder="Search name, ticker or pair" value={q} onChange={(e) => setQ(e.target.value)} /><span className="eyebrow">{list.length} of {totals.n}</span></div>
          </div>
          <div className="list">
            <div className="lh">
              <button className={sort === "new" ? "on" : ""} onClick={head("new")}>Coin {sort === "new" ? (desc ? "↓" : "↑") : ""}</button>
              {COLS.map((c) => <button key={c.k} className={c.cls + (sort === c.k ? " on" : "")} onClick={head(c.k)}>{c.l} {sort === c.k ? (desc ? "↓" : "↑") : ""}</button>)}
            </div>
            {isLoading && !tokens ? [0, 1, 2].map((i) => <div key={i} className="skel" style={{ height: 66, margin: 8 }} />)
              : list.length === 0 ? <div className="empty">{q || pair ? "Nothing matches." : "No coins yet. Be the first."}</div>
              : list.map((t, i) => <Row key={t.address} t={t} i={i} max={maxPaid} />)}
          </div>
        </section>
      )}
    </main>
  );
}

function Row({ t, i, max }: { t: Token; i: number; max: number }) {
  const c = t.priceChange24hPct;
  const paid = paidUsd(t);
  const kind = pairKind(t);
  return (
    <Link to={`/t/${t.address}`} className="lr" style={{ animationDelay: `${Math.min(i, 14) * 25}ms` }}>
      <span className="who">
        <Art src={t.metadata?.logo} name={t.name} className="art" />
        <span style={{ minWidth: 0 }}>
          <b>{t.name}</b>
          <small><span>{t.symbol}</span>{isPinned(t.address) && <span className="chip official">official</span>}<span className={"chip " + kind}>{t.pair.symbol}</span><span>{ago(t.createdAt)}</span></small>
        </span>
      </span>
      <span className="n c-price">{usd(t.priceUsd)}</span>
      <span className={"n c-chg " + (c == null ? "faint" : c >= 0 ? "up" : "down")}>{c == null ? "new" : pct(c)}</span>
      <span className="n c-mcap">{usd(t.marketCapUsd, { compact: true })}<small className={c == null ? "" : c >= 0 ? "up" : "down"}>{c == null ? "new" : pct(c)}</small></span>
      <span className="n c-vol">{usd(wei(t.volume24hWei) * t.pair.usd, { compact: true })}</span>
      <span className="n c-hold">{num(t.holderCount, 0)}</span>
      <span className="paid c-paid">
        <b>{usd(paid, { compact: true })}</b>
        <span>{t.rewards ? `${num(wei(t.rewards.holders), 4)} ${t.pair.symbol}` : "—"}</span>
        <span className="bar"><i style={{ width: `${Math.min(100, (paid / max) * 100)}%` }} /></span>
      </span>
    </Link>
  );
}
