import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { Art } from "../components/Art";
import { DEPLOYED, FEES, isHidden } from "../lib/env";
import { ago, pct, usd, wei } from "../lib/format";
import { useTokens, type Token } from "../lib/hooks";

type Sort = "new" | "top" | "movers" | "stocks";

export default function Home() {
  const { data: all, isLoading } = useTokens();
  const tokens = useMemo(() => all?.filter((t) => !isHidden(t.address)), [all]);
  const [sp] = useSearchParams();
  const [sort, setSort] = useState<Sort>((["new", "top", "movers", "stocks"].includes(sp.get("sort") ?? "") ? sp.get("sort") : "new") as Sort);
  const [q, setQ] = useState("");

  const list = useMemo(() => {
    let l = (tokens ?? []).slice();
    const s = q.trim().toLowerCase();
    if (s) l = l.filter((t) => `${t.name} ${t.symbol} ${t.address} ${t.pair.symbol}`.toLowerCase().includes(s));
    if (sort === "top") l.sort((a, b) => Number(b.marketCapUsd) - Number(a.marketCapUsd));
    else if (sort === "movers") l.sort((a, b) => (b.priceChange24hPct ?? -1e9) - (a.priceChange24hPct ?? -1e9));
    else if (sort === "stocks") l = l.filter((t) => !t.pair.isNative).sort((a, b) => Number(b.volume24hWei) * b.pair.usd - Number(a.volume24hWei) * a.pair.usd);
    else l.sort((a, b) => b.createdAt - a.createdAt);
    return l;
  }, [tokens, sort, q]);

  const fresh = useMemo(() => (tokens ?? []).filter((t) => Date.now() / 1000 - t.createdAt < 3600).sort((a, b) => b.createdAt - a.createdAt).slice(0, 4), [tokens]);

  if (!DEPLOYED) {
    return (
      <main className="page"><section className="hero" style={{ gridTemplateColumns: "1fr" }}><div><div className="lbl" style={{ marginBottom: 12 }}>Not live yet</div><h1>Deploying to <em>Ethereum</em>.</h1><p className="sub">The factory is not on-chain yet. Check back shortly.</p></div></section></main>
    );
  }

  return (
    <main className="page">
      {fresh.length > 0 && (
        <section className="sec">
          <div className="sec-h"><h2>Just launched</h2><span className="lbl">last hour</span></div>
          <div className="grid">{fresh.map((t) => <Card key={t.address} t={t} />)}</div>
        </section>
      )}

      <section className="sec">
        <div className="sec-h">
          <h2>All coins</h2>
          <div className="toolbar">
            <div className="seg">
              {(["new", "top", "movers", "stocks"] as Sort[]).map((k) => <button key={k} className={sort === k ? "on" : ""} onClick={() => setSort(k)}>{k === "new" ? "Newest" : k === "top" ? "Biggest" : k === "movers" ? "Movers" : "Stock pairs"}</button>)}
            </div>
            <input className="inp m-search" placeholder="Search name, ticker, pair" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        {isLoading && !tokens ? (
          <div className="grid">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="card skeleton" style={{ minHeight: 200 }} />)}</div>
        ) : list.length === 0 ? (
          <div className="panel"><p className="small" style={{ margin: 0 }}>{q ? "Nothing matches." : "No coins yet."} <Link to="/launch" style={{ color: "var(--green)" }}>Launch the first one</Link>. Every trade pays {FEES.taxPct}% to the creator, the holders and the platform.</p></div>
        ) : (
          <div className="grid">{list.map((t) => <Card key={t.address} t={t} />)}</div>
        )}
      </section>
    </main>
  );
}

function Card({ t }: { t: Token }) {
  const chg = t.priceChange24hPct;
  const fresh = Date.now() / 1000 - t.createdAt < 3600;
  const vol = wei(t.volume24hWei) * t.pair.usd;
  return (
    <Link to={`/t/${t.address}`} className="card">
      <span className="live"><i />TRADING</span>
      <Art src={t.metadata?.logo} name={t.name} className="art" />
      {fresh ? <span className="tag">NEW</span> : !t.pair.isNative ? <span className="tag amber">{t.pair.symbol}</span> : null}
      <h3>{t.name}</h3>
      <p>{t.symbol} · pairs {t.pair.symbol} · {ago(t.createdAt)} · {usd(vol, { compact: true })} today</p>
      <div className="st"><b>{usd(t.marketCapUsd, { compact: true })} cap</b><span className={chg == null ? "faint" : chg >= 0 ? "up" : "down"}>{pct(chg)}</span></div>
    </Link>
  );
}
