import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { Logo } from "../components/Logo";
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

  const stats = useMemo(() => {
    const all = tokens ?? [];
    const vol = all.reduce((s, t) => s + wei(t.volume24hWei) * hypeUsd, 0);
    const cap = all.reduce((s, t) => s + Number(t.marketCapUsd), 0);
    const day = all.filter((t) => Date.now() / 1000 - t.createdAt < 86400).length;
    return { n: all.length, vol, cap, day };
  }, [tokens, hypeUsd]);

  return (
    <main className="page">
      <section className="hero">
        <div className="eyebrow">HyperEVM</div>
        <h1>Launch a coin. Watch it go.</h1>
        <p className="sub">Free to launch, live in one transaction. Liquidity locked forever. Every trade pays the people who hold it.</p>
        <div className="cta">
          <Link to="/launch" className="go" style={{ textDecoration: "none" }}>Launch a coin</Link>
          <Link to="/docs" className="learn" style={{ textDecoration: "none" }}>How it works</Link>
        </div>
        <div className="stats">
          <div><div className="v">{isLoading ? "—" : num(stats.n, 0)}</div><div className="k">coins launched</div></div>
          <div><div className="v">{isLoading ? "—" : usd(stats.vol, { compact: true })}</div><div className="k">traded today</div></div>
          <div><div className="v">{isLoading ? "—" : usd(stats.cap, { compact: true })}</div><div className="k">total market cap</div></div>
          <div><div className="v">{isLoading ? "—" : stats.day}</div><div className="k">new in 24h</div></div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 20 }}>
        <div className="toolbar">
          <div className="segmented" role="tablist">
            {(["new", "top", "movers"] as Sort[]).map((s) => (
              <button key={s} role="tab" className={sort === s ? "on" : ""} onClick={() => setSort(s)}>{s === "new" ? "New" : s === "top" ? "Top" : "Movers"}</button>
            ))}
          </div>
          <label className="search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input placeholder="Search coins" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>

        {isLoading ? (
          <div className="grid">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton" />)}</div>
        ) : list.length === 0 ? (
          <div className="panel soft" style={{ textAlign: "center", padding: 40 }}>
            <h3>{q ? "No coins match." : "No coins yet."}</h3>
            <p className="small">{q ? "Try another name or paste an address." : "Be the first to launch one."}</p>
          </div>
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
  return (
    <Link to={`/t/${t.address}`} className="card">
      <Logo src={t.metadata?.logo} name={t.name} />
      <div className="name"><span>{t.name}</span>{fresh && <span className="badge new">New</span>}</div>
      <div className="sym">{t.symbol} · {ago(t.createdAt)}</div>
      <div className="meta">
        <span className="cap">{usd(t.marketCapUsd, { compact: true })}</span>
        <span className={"chg " + (chg == null ? "faint" : chg >= 0 ? "up" : "down")}>{pct(chg)}</span>
      </div>
    </Link>
  );
}
