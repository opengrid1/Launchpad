import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { Art, Spark } from "../components/Art";
import { OrbitScene } from "../components/OrbitScene";
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

  const spotlight = useMemo(() => (tokens ?? []).slice().sort((a, b) => wei(b.volume24hWei) - wei(a.volume24hWei) || Number(b.marketCapUsd) - Number(a.marketCapUsd)).slice(0, 4), [tokens]);

  const stats = useMemo(() => {
    const all = tokens ?? [];
    return {
      n: all.length,
      vol: all.reduce((s, t) => s + wei(t.volume24hWei) * hypeUsd, 0),
      cap: all.reduce((s, t) => s + Number(t.marketCapUsd), 0),
      holders: all.reduce((s, t) => s + (t.holderCount || 0), 0),
    };
  }, [tokens, hypeUsd]);

  const bodies = useMemo(() => (tokens ?? []).slice(0, 9).map((t) => ({ name: t.name, src: t.metadata?.logo })), [tokens]);

  return (
    <main>
      <section className="herob">
        <div className="herob-in">
          <div className="herob-copy">
            <div className="eyebrow light">Launchpad · HyperEVM</div>
            <h1>Every coin<br />starts here.</h1>
            <p className="sub light">Launch in one transaction. Liquidity locked for good. One percent of every trade goes back to the people holding.</p>
            <div className="cta">
              <Link to="/launch" className="go" style={{ textDecoration: "none" }}>Launch a coin</Link>
              <a href="#coins" className="learn light" style={{ textDecoration: "none" }}>See what's live</a>
            </div>
            <div className="chips-stat">
              <div><b>{isLoading ? "—" : num(stats.n, 0)}</b><span>coins</span></div>
              <div><b>{isLoading ? "—" : usd(stats.vol, { compact: true })}</b><span>traded today</span></div>
              <div><b>{isLoading ? "—" : usd(stats.cap, { compact: true })}</b><span>market cap</span></div>
              <div><b>{isLoading ? "—" : num(stats.holders, 0)}</b><span>holders</span></div>
            </div>
          </div>
          <div className="herob-art"><OrbitScene bodies={bodies} /></div>
        </div>
      </section>

      <div className="page" id="coins">
        {spotlight.length > 0 && (
          <section className="section" style={{ paddingTop: 36 }}>
            <div className="between" style={{ marginBottom: 14 }}><h2 style={{ margin: 0 }}>In motion</h2><span className="small">Most traded today</span></div>
            <div className="spot">{spotlight.map((t) => <Spot key={t.address} t={t} hypeUsd={hypeUsd} />)}</div>
          </section>
        )}

        <section className="section" style={{ paddingTop: 28 }}>
          <div className="toolbar">
            <h2 style={{ margin: 0 }}>All coins</h2>
            <div className="row" style={{ flexWrap: "wrap" }}>
              <div className="segmented" role="tablist">
                {(["new", "top", "movers"] as Sort[]).map((s) => (
                  <button key={s} role="tab" className={sort === s ? "on" : ""} onClick={() => setSort(s)}>{s === "new" ? "New" : s === "top" ? "Top" : "Movers"}</button>
                ))}
              </div>
              <label className="search">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                <input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
              </label>
            </div>
          </div>

          {isLoading ? (
            <div className="grid">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton" />)}</div>
          ) : list.length === 0 ? (
            <div className="panel soft" style={{ textAlign: "center", padding: 40 }}>
              <h3>{q ? "No coins match." : "No coins yet."}</h3>
              <p className="small">{q ? "Try another name or paste an address." : "Be the first to launch one."}</p>
            </div>
          ) : (
            <div className="grid">{list.map((t) => <Card key={t.address} t={t} hypeUsd={hypeUsd} />)}</div>
          )}
        </section>

        <section className="section how">
          <h2>Built to be fair.</h2>
          <p className="sub">The same rules for every coin, enforced by one contract. Nothing to configure, nothing to trust.</p>
          <div className="features">
            <div className="feature"><div className="big">$0</div><h3>Free to launch</h3><p>One transaction deploys the token and opens a HyperSwap pool seeded with the full supply.</p></div>
            <div className="feature"><div className="big">∞</div><h3>Liquidity locked</h3><p>The pool position is held by the factory. Nobody can pull it, not even the creator.</p></div>
            <div className="feature"><div className="big">1%</div><h3>One fee, shared</h3><p>Half to holders, 40% to the creator, 10% to the platform. Paid in HYPE, claimed any time.</p></div>
          </div>
          <div className="cta" style={{ marginTop: 22 }}><Link to="/docs" className="learn" style={{ textDecoration: "none" }}>Read how it works</Link></div>
        </section>
      </div>
    </main>
  );
}

function Spot({ t, hypeUsd }: { t: Token; hypeUsd: number }) {
  const chg = t.priceChange24hPct;
  const up = (chg ?? 0) >= 0;
  return (
    <Link to={`/t/${t.address}`} className="spotc">
      <Art src={t.metadata?.logo} name={t.name} className="bg" />
      <div className="veil" />
      <div className="top"><Art src={t.metadata?.logo} name={t.name} className="mini" size={44} /><div className="spark"><Spark data={t.sparkline} up={up} width={110} height={34} /></div></div>
      <div className="bot">
        <div className="nm">{t.name}<span>{t.symbol}</span></div>
        <div className="pr">{usd(t.priceUsd)}<span className={up ? "up" : "down"}>{pct(chg)}</span></div>
        <div className="ln">{usd(wei(t.volume24hWei) * hypeUsd, { compact: true })} traded · {usd(t.marketCapUsd, { compact: true })} cap</div>
      </div>
    </Link>
  );
}

function Card({ t, hypeUsd }: { t: Token; hypeUsd: number }) {
  const chg = t.priceChange24hPct;
  const up = (chg ?? 0) >= 0;
  const fresh = Date.now() / 1000 - t.createdAt < 3600;
  return (
    <Link to={`/t/${t.address}`} className="card">
      <div className="artwrap"><Art src={t.metadata?.logo} name={t.name} />{fresh && <span className="badge new float">New</span>}</div>
      <div className="name"><span>{t.name}</span></div>
      <div className="sym">{t.symbol} · {ago(t.createdAt)}</div>
      <div className="meta">
        <div><div className="cap">{usd(t.marketCapUsd, { compact: true })}</div><div className={"chg " + (chg == null ? "faint" : up ? "up" : "down")}>{pct(chg)}</div></div>
        <Spark data={t.sparkline} up={up} width={84} height={28} />
      </div>
      <div className="foot2"><span>{num(t.holderCount || 0, 0)} holders</span><span>{usd(wei(t.volume24hWei) * hypeUsd, { compact: true })} today</span></div>
    </Link>
  );
}
