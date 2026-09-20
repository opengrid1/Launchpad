import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Art } from "../components/Art";
import { DEPLOYED, FEES, isHidden, isPinned } from "../lib/env";
import { ago, num, pct, usd, wei } from "../lib/format";
import { useQuotes, useTokens, type Token } from "../lib/hooks";
import { isTokenPair } from "../lib/stocks";

const paidUsd = (t: Token) => (t.rewards ? wei(t.rewards.holders) * t.pair.usd : 0);
const kindOf = (isNative: boolean, addr: string) => (isNative ? "eth" : isTokenPair(addr) ? "token" : "stock");

type Col = "new" | "price" | "chg" | "mcap" | "vol" | "holders" | "paid";
type Filter = "all" | "eth" | "token" | "stock";

export default function Home() {
  const nav = useNavigate();
  const { data: all, isLoading } = useTokens();
  const { data: quotes } = useQuotes();
  const tokens = useMemo(() => all?.filter((t) => !isHidden(t.address)), [all]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Col>("mcap");
  const [desc, setDesc] = useState(true);

  const totals = useMemo(() => {
    const t = tokens ?? [];
    return { n: t.length, vol: t.reduce((s, x) => s + wei(x.volume24hWei) * x.pair.usd, 0), paid: t.reduce((s, x) => s + paidUsd(x), 0), holders: t.reduce((s, x) => s + (x.holderCount ?? 0), 0) };
  }, [tokens]);
  const approved = useMemo(() => (quotes ?? []).filter((x) => x.approved), [quotes]);

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
    if (filter !== "all") l = l.filter((t) => kindOf(t.pair.isNative, t.pair.address) === filter);
    l.sort((a, b) => (desc ? key(b) - key(a) : key(a) - key(b)));
    l.sort((a, b) => Number(isPinned(b.address)) - Number(isPinned(a.address)));
    return l;
  }, [tokens, q, filter, sort, desc]);
  const head = (k: Col) => () => { if (sort === k) setDesc(!desc); else { setSort(k); setDesc(true); } };
  const arrow = (k: Col) => (sort === k ? (desc ? " ↓" : " ↑") : "");

  // Pairs by activity: coins launched against them, and what those coins paid out.
  const pairs = useMemo(() => {
    const m = new Map<string, { sym: string; kind: string; usd: number; coins: number; paid: number }>();
    for (const t of tokens ?? []) {
      const k = t.pair.address.toLowerCase();
      const e = m.get(k) ?? { sym: t.pair.symbol, kind: kindOf(t.pair.isNative, t.pair.address), usd: t.pair.usd, coins: 0, paid: 0 };
      e.coins++; e.paid += paidUsd(t); m.set(k, e);
    }
    for (const x of approved) {
      const k = x.address.toLowerCase();
      if (!m.has(k) && (x.isNative || isTokenPair(x.address))) m.set(k, { sym: x.symbol, kind: kindOf(x.isNative, x.address), usd: x.usd, coins: 0, paid: 0 });
    }
    return [...m.values()].sort((a, b) => b.coins - a.coins || b.paid - a.paid).slice(0, 8);
  }, [tokens, approved]);
  const nTokens = approved.filter((x) => !x.isNative && isTokenPair(x.address)).length;
  const nStocks = approved.filter((x) => !x.isNative && !isTokenPair(x.address)).length;

  return (
    <main className="home">
      <div>
        <div className="toolbar">
          <input className="in" placeholder="Search coins" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="seg">
            {(["all", "eth", "token", "stock"] as Filter[]).map((f) => <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>{f === "all" ? "All" : f === "eth" ? "ETH pairs" : f === "token" ? "Token pairs" : "Stock pairs"}</button>)}
          </div>
          <span className="spacer" />
          <div className="stats c-hide-sm">
            <span>Coins<b>{num(totals.n, 0)}</b></span>
            <span>24h volume<b>{usd(totals.vol, { compact: true })}</b></span>
            <span>Paid to holders<b>{usd(totals.paid, { compact: true })}</b></span>
          </div>
        </div>

        {!DEPLOYED ? (
          <div className="card"><div className="empty">The factory is not on Ethereum yet.</div></div>
        ) : isLoading && !tokens ? (
          <div className="skel" style={{ height: 420 }} />
        ) : (
          <div className="tbl">
            <table>
              <thead>
                <tr>
                  <th><button className={sort === "new" ? "on" : ""} onClick={head("new")}>Coin{arrow("new")}</button></th>
                  <th>Pays in</th>
                  <th className="r"><button className={sort === "price" ? "on" : ""} onClick={head("price")}>Price{arrow("price")}</button></th>
                  <th className="r c-hide-sm"><button className={sort === "chg" ? "on" : ""} onClick={head("chg")}>24h{arrow("chg")}</button></th>
                  <th className="r"><button className={sort === "mcap" ? "on" : ""} onClick={head("mcap")}>Market cap{arrow("mcap")}</button></th>
                  <th className="r c-hide-md"><button className={sort === "vol" ? "on" : ""} onClick={head("vol")}>Volume 24h{arrow("vol")}</button></th>
                  <th className="r c-hide-md"><button className={sort === "holders" ? "on" : ""} onClick={head("holders")}>Holders{arrow("holders")}</button></th>
                  <th className="r c-hide-sm"><button className={sort === "paid" ? "on" : ""} onClick={head("paid")}>Paid to holders{arrow("paid")}</button></th>
                </tr>
              </thead>
              <tbody>
                {list.length === 0 && <tr><td colSpan={8}><div className="empty">{tokens?.length ? "No coins match." : "No coins yet."}</div></td></tr>}
                {list.map((t) => {
                  const c = t.priceChange24hPct;
                  const kind = kindOf(t.pair.isNative, t.pair.address);
                  return (
                    <tr key={t.address} className="link" onClick={() => nav(`/t/${t.address}`)}>
                      <td><Link to={`/t/${t.address}`} className="coin" onClick={(e) => e.stopPropagation()}>
                        <Art src={t.metadata?.logo} name={t.name} className="art" />
                        <span style={{ minWidth: 0 }}><b>{t.name}</b><small><span>{t.symbol}</span>{isPinned(t.address) && <span className="chip official" style={{ height: 18, fontSize: 10.5 }}>Official</span>}<span>{ago(t.createdAt)}</span></small></span>
                      </Link></td>
                      <td><span className={"chip " + kind}>{t.pair.symbol}</span></td>
                      <td className="r">{usd(t.priceUsd)}</td>
                      <td className={"r c-hide-sm " + (c == null ? "faint" : c >= 0 ? "up" : "down")}>{c == null ? "—" : pct(c)}</td>
                      <td className="r">{usd(t.marketCapUsd, { compact: true })}</td>
                      <td className="r c-hide-md">{usd(wei(t.volume24hWei) * t.pair.usd, { compact: true })}</td>
                      <td className="r c-hide-md">{num(t.holderCount, 0)}</td>
                      <td className="r c-hide-sm">{usd(paidUsd(t), { compact: true })}<small>{t.rewards ? `${num(wei(t.rewards.holders), 4)} ${t.pair.symbol}` : "—"}</small></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <aside className="side">
        <div className="card">
          <div className="card-h"><h2>How it works</h2><Link to="/docs" className="b ghost sm">Docs</Link></div>
          <div className="card-b steps">
            <div><span>1</span><p><b>Pick a pair asset.</b> ETH, UNI, LINK, PEPE, a tokenized stock. The coin is priced in it.</p></div>
            <div><span>2</span><p><b>Every trade pays {FEES.taxPct}%.</b> {FEES.holderPct}% goes to holders in the pair asset, {FEES.creatorPct}% to the creator, {FEES.platformPct}% to the platform.</p></div>
            <div><span>3</span><p><b>Hold and claim.</b> Rewards accrue per trade. No staking, no lockup. Liquidity is burned at launch.</p></div>
          </div>
          <div style={{ padding: "0 14px 14px" }}><Link to="/launch" className="b pri wide">Launch a coin</Link></div>
        </div>
        <div className="card">
          <div className="card-h"><h2>Pair assets</h2><span className="eyebrow">ETH · {nTokens} tokens · {nStocks} stocks</span></div>
          <div className="pairlist">
            {pairs.map((p) => (
              <Link key={p.sym} to="/launch">
                <span className={"av " + p.kind}>{p.sym.replace(/on$/, "").slice(0, 4)}</span>
                <span><b style={{ fontWeight: 500 }}>{p.sym}</b><small>{p.coins === 0 ? "No coins yet" : `${p.coins} coin${p.coins === 1 ? "" : "s"} · ${usd(p.paid, { compact: true })} paid`}</small></span>
                <span className="n">{p.usd > 0 ? usd(p.usd, { compact: p.usd >= 10_000 }) : ""}</span>
              </Link>
            ))}
          </div>
        </div>
      </aside>
    </main>
  );
}
