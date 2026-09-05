import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { Art } from "../components/Art";
import { DEPLOYED, FEES, isHidden } from "../lib/env";
import { ago, num, pct, usd, wei } from "../lib/format";
import { useQuotes, useTokens, type Token } from "../lib/hooks";

type Sort = "new" | "mcap" | "vol" | "chg" | "paid";
const SORTS: { k: Sort; l: string }[] = [{ k: "new", l: "New" }, { k: "mcap", l: "Market cap" }, { k: "vol", l: "Volume" }, { k: "chg", l: "24h" }, { k: "paid", l: "Paid out" }];

const paidUsd = (t: Token) => (t.rewards ? wei(t.rewards.holders + t.rewards.creator + t.rewards.platform) * t.pair.usd : 0);

export default function Home() {
  const { data: all, isLoading } = useTokens();
  const { data: quotes } = useQuotes();
  const tokens = useMemo(() => all?.filter((t) => !isHidden(t.address)), [all]);
  const [sort, setSort] = useState<Sort>("new");
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<"all" | "eth" | "stock">("all");

  const key = (t: Token): number => {
    switch (sort) {
      case "mcap": return Number(t.marketCapUsd);
      case "vol": return wei(t.volume24hWei) * t.pair.usd;
      case "chg": return t.priceChange24hPct ?? -1e9;
      case "paid": return paidUsd(t);
      default: return t.createdAt;
    }
  };
  const list = useMemo(() => {
    let l = (tokens ?? []).slice();
    const s = q.trim().toLowerCase();
    if (s) l = l.filter((t) => `${t.name} ${t.symbol} ${t.address} ${t.pair.symbol}`.toLowerCase().includes(s));
    if (only === "eth") l = l.filter((t) => t.pair.isNative);
    if (only === "stock") l = l.filter((t) => !t.pair.isNative);
    l.sort((a, b) => key(b) - key(a));
    return l;
  }, [tokens, q, only, sort]);
  const totals = useMemo(() => {
    const t = tokens ?? [];
    return { n: t.length, vol: t.reduce((s, x) => s + wei(x.volume24hWei) * x.pair.usd, 0), paid: t.reduce((s, x) => s + paidUsd(x), 0) };
  }, [tokens]);
  const stocks = quotes ? quotes.filter((x) => x.approved && !x.isNative).length : 0;

  return (
    <main className="page">
      <section className="lead">
        <div className="say">
          <h1>Coins paired with <em>real stocks</em>.</h1>
          <p>Launch a coin on Ethereum with NVIDIA, Tesla, SPY or {stocks > 0 ? `any of ${stocks} tokenized stocks` : "another tokenized stock"} on the other side of the pool. Trade in plain ETH. Every swap pays {FEES.taxPct}%: half to the creator, {FEES.holderPct}% to holders, the rest to the platform.</p>
          <div className="cta"><Link to="/launch" className="btn acc">Launch a coin</Link><Link to="/docs" className="btn">How it works</Link></div>
        </div>
        <div className="stats">
          <div className="acc"><b>{num(totals.n, 0)}</b><span>coins live</span></div>
          <div><b>{usd(totals.vol, { compact: true })}</b><span>volume 24h</span></div>
          <div><b>{usd(totals.paid, { compact: true })}</b><span>paid out</span></div>
        </div>
      </section>

      {!DEPLOYED ? (
        <section className="sec"><div className="panel"><div className="empty">The factory is not on Ethereum yet. Check back shortly.</div></div></section>
      ) : (
        <section className="sec">
          <div className="sec-h">
            <div className="tools">
              <div className="seg">
                <button className={only === "all" ? "on" : ""} onClick={() => setOnly("all")}>All</button>
                <button className={only === "stock" ? "on" : ""} onClick={() => setOnly("stock")}>Stock pairs</button>
                <button className={only === "eth" ? "on" : ""} onClick={() => setOnly("eth")}>ETH pairs</button>
              </div>
              <div className="seg">{SORTS.map((s) => <button key={s.k} className={sort === s.k ? "on" : ""} onClick={() => setSort(s.k)}>{s.l}</button>)}</div>
            </div>
            <input className="inp" style={{ width: 240 }} placeholder="Search name, ticker or pair" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {isLoading && !tokens ? (
            <div className="grid">{[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 230 }} />)}</div>
          ) : (
            <div className="grid">
              {list.map((t, i) => <Tile key={t.address} t={t} i={i} />)}
              <Link to="/launch" className="tile ghost"><div><b>{list.length === 0 ? (q ? "Nothing matches" : "No coins yet") : "Launch yours"}</b>One transaction. Pick ETH or a stock as the pair. Earn {FEES.creatorPct}% of every trade fee.</div></Link>
            </div>
          )}
        </section>
      )}
    </main>
  );
}

export function Tile({ t, i = 0 }: { t: Token; i?: number }) {
  const c = t.priceChange24hPct;
  return (
    <Link to={`/t/${t.address}`} className="tile" style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}>
      <div className="tile-top">
        <Art src={t.metadata?.logo} name={t.name} className="tile-art" />
        <span className={"stamp " + (t.pair.isNative ? "eth" : "stock")}><i />{t.pair.symbol}</span>
      </div>
      <div className="tile-name"><b>{t.name}</b><span>{t.symbol}</span></div>
      <div className="tile-cap">
        <div><span className="k">Market cap</span><span className="v">{usd(t.marketCapUsd, { compact: true })}</span></div>
        <span className={"chg " + (c == null ? "" : c >= 0 ? "up" : "down")}>{c == null ? "new" : pct(c)}</span>
      </div>
      <div className="tile-meta">
        <span><b>{usd(wei(t.volume24hWei) * t.pair.usd, { compact: true })}</b>vol</span>
        <span><b>{num(t.holderCount, 0)}</b>holders</span>
        <span><b>{usd(paidUsd(t), { compact: true })}</b>paid</span>
        <span>{ago(t.createdAt)}</span>
      </div>
    </Link>
  );
}
