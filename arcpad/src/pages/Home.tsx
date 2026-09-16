import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { Art } from "../components/Art";
import { DEPLOYED, FEES, isHidden, isPinned } from "../lib/env";
import { ago, num, pct, usd, wei } from "../lib/format";
import { useTokens, type Token } from "../lib/hooks";

type Sort = "new" | "mcap" | "vol" | "chg" | "paid" | "holders";
const SORTS: { k: Sort; l: string }[] = [{ k: "new", l: "New" }, { k: "mcap", l: "Market cap" }, { k: "vol", l: "Volume" }, { k: "chg", l: "24h" }, { k: "paid", l: "Paid out" }, { k: "holders", l: "Holders" }];

const paidUsd = (t: Token) => (t.rewards ? wei(t.rewards.creator) * t.pair.usd : 0);

export default function Home() {
  const { data: all, isLoading } = useTokens();
  const tokens = useMemo(() => all?.filter((t) => !isHidden(t.address)), [all]);
  const [sort, setSort] = useState<Sort>("new");
  const [desc, setDesc] = useState(true);
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
    l.sort((a, b) => (desc ? key(b) - key(a) : key(a) - key(b)));
    // Official coins stay on top whatever the sort.
    l.sort((a, b) => Number(isPinned(b.address)) - Number(isPinned(a.address)));
    return l;
  }, [tokens, q, sort, desc]);
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
              <div className="seg sort-seg">{SORTS.map((s) => <button key={s.k} className={sort === s.k ? "on" : ""} onClick={() => setSort(s.k)}>{s.l}</button>)}</div>
              <button className={"dir dir-wide" + (desc ? "" : " asc")} onClick={() => setDesc((d) => !d)} aria-label="Toggle sort direction">{desc ? "↓ Highest first" : "↑ Lowest first"}</button>
            </div>
            <div className="search-row">
              <input className="inp" placeholder="Search name, ticker or pair" value={q} onChange={(e) => setQ(e.target.value)} />
              <button className={"dir dir-icon" + (desc ? "" : " asc")} onClick={() => setDesc((d) => !d)} aria-label="Toggle sort direction">{desc ? "↓" : "↑"}</button>
            </div>
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
