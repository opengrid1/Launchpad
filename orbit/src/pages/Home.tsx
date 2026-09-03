import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { Art } from "../components/Art";
import { ago, num, pct, usd, wei } from "../lib/format";
import { useHypeUsd, useTokens, type Token } from "../lib/hooks";

type Sort = "new" | "top" | "movers";

export default function Home() {
  const { data: tokens, isLoading } = useTokens();
  const { data: hypeUsd = 0 } = useHypeUsd();
  const [sort, setSort] = useState<Sort>("new");
  const [q, setQ] = useState("");

  const list = useMemo(() => {
    let l = (tokens ?? []).slice();
    const s = q.trim().toLowerCase();
    if (s) l = l.filter((t) => `${t.name} ${t.symbol} ${t.address}`.toLowerCase().includes(s));
    if (sort === "top") l.sort((a, b) => Number(b.marketCapUsd) - Number(a.marketCapUsd));
    else if (sort === "movers") l.sort((a, b) => (b.priceChange24hPct ?? -1e9) - (a.priceChange24hPct ?? -1e9));
    else l.sort((a, b) => b.createdAt - a.createdAt);
    return l;
  }, [tokens, sort, q]);

  const onair = useMemo(() => (tokens ?? []).slice().sort((a, b) => wei(b.volume24hWei) - wei(a.volume24hWei) || b.createdAt - a.createdAt).slice(0, 4), [tokens]);

  return (
    <main className="page">
      <section className="hero">
        <div>
          <div className="lbl row" style={{ gap: 10, marginBottom: 14 }}><span className="dot" />Broadcasting from HyperEVM</div>
          <h1>Go <em>live</em><br />with a coin.</h1>
          <p className="sub">Launch in one transaction and it's on air. Every trade is broadcast here, and every trade pays the people holding.</p>
          <div className="cta"><Link to="/launch" className="btn red">Go live</Link><a href="#feed" className="btn ghost">Watch the feed</a></div>
        </div>
        <div className="board">
          <div className="lbl"><span className="dot" />On air now</div>
          {isLoading ? <div className="empty">Tuning in…</div> : onair.length === 0 ? <div className="empty">Nothing on air yet. Be the first.</div> : onair.map((t) => (
            <Link key={t.address} to={`/t/${t.address}`} className="rowi">
              <Art src={t.metadata?.logo} name={t.name} className="av" />
              <div className="nm">{t.name}<small>{t.symbol} · {ago(t.createdAt)} · {num(t.holderCount || 0, 0)} holders</small></div>
              <div className="px"><b>{usd(t.priceUsd)}</b><span className={(t.priceChange24hPct ?? 0) >= 0 ? "up" : "down"}>{pct(t.priceChange24hPct)}</span></div>
            </Link>
          ))}
        </div>
      </section>

      <section className="sec" id="feed">
        <div className="sec-h">
          <h2>Feed</h2>
          <div className="toolbar">
            <div className="seg">{(["new", "top", "movers"] as Sort[]).map((s) => <button key={s} className={sort === s ? "on" : ""} onClick={() => setSort(s)}>{s === "new" ? "Newest" : s === "top" ? "Biggest" : "Movers"}</button>)}</div>
            <label className="search"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg><input placeholder="Search coins" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          </div>
        </div>
        <div className="grid">
          {isLoading ? Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton" />) : (
            <>
              {list.map((t) => <Card key={t.address} t={t} hypeUsd={hypeUsd} />)}
              <Link to="/launch" className="card new"><div><div className="plus">+</div>Your coin here<br /><small>free · one transaction</small></div></Link>
            </>
          )}
        </div>
        {!isLoading && list.length === 0 && q && <p className="small" style={{ marginTop: 12 }}>No coins match "{q}".</p>}
      </section>

      <div className="rules">
        <div><b>$0</b><span>to launch. Gas only, one transaction.</span></div>
        <div><b className="r">1%</b><span>fee on every trade. The only fee.</span></div>
        <div><b>50%</b><span>of it paid to holders. 40% to the creator.</span></div>
        <div><b>∞</b><span>liquidity locked in the factory. No rug possible.</span></div>
      </div>
    </main>
  );
}

function Card({ t, hypeUsd }: { t: Token; hypeUsd: number }) {
  const chg = t.priceChange24hPct;
  const fresh = Date.now() / 1000 - t.createdAt < 3600;
  return (
    <Link to={`/t/${t.address}`} className="card">
      <span className="live"><i />LIVE</span>
      <Art src={t.metadata?.logo} name={t.name} className="art" />
      {fresh && <span className="tag">NEW</span>}
      <h3>{t.name}</h3>
      <p>{t.symbol} · {ago(t.createdAt)} · {usd(wei(t.volume24hWei) * hypeUsd, { compact: true })} today</p>
      <div className="st"><b>{usd(t.marketCapUsd, { compact: true })} cap</b><span className={chg == null ? "faint" : chg >= 0 ? "up" : "down"}>{pct(chg)}</span></div>
    </Link>
  );
}
