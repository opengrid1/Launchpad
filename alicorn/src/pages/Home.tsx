import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Art } from "../components/Art";
import { FeeBar } from "../components/FeeBar";
import { Icon } from "../components/Icon";
import { Spark } from "../components/Spark";
import { DEPLOYED, FEES, isHidden, isPinned } from "../lib/env";
import { ago, num, pct, usd, wei } from "../lib/format";
import { useQuotes, useTokens, type Token } from "../lib/hooks";
import { isTokenPair } from "../lib/stocks";

const paidUsd = (t: Token) => (t.rewards ? wei(t.rewards.holders, t.pair.decimals) * t.pair.usd : 0);
const volUsd = (t: Token) => wei(t.volume24hWei, t.pair.decimals) * t.pair.usd;
const kindOf = (isNative: boolean, addr: string, v3Fee?: number) => (isNative ? "eth" : isTokenPair(addr) || v3Fee ? "token" : "stock");

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
  // The header search box drives the list.
  useEffect(() => {
    const on = (e: Event) => setQ(String((e as CustomEvent).detail ?? ""));
    window.addEventListener("alicorn:search", on);
    return () => window.removeEventListener("alicorn:search", on);
  }, []);

  const totals = useMemo(() => {
    const t = tokens ?? [];
    return { n: t.length, vol: t.reduce((s, x) => s + volUsd(x), 0), paid: t.reduce((s, x) => s + paidUsd(x), 0), holders: t.reduce((s, x) => s + (x.holderCount ?? 0), 0) };
  }, [tokens]);
  const approved = useMemo(() => (quotes ?? []).filter((x) => x.approved), [quotes]);

  const key = (t: Token): number => {
    switch (sort) {
      case "price": return Number(t.priceUsd);
      case "chg": return t.priceChange24hPct ?? -1e9;
      case "mcap": return Number(t.marketCapUsd);
      case "vol": return volUsd(t);
      case "holders": return t.holderCount ?? 0;
      case "paid": return paidUsd(t);
      default: return t.createdAt;
    }
  };
  const list = useMemo(() => {
    let l = (tokens ?? []).slice();
    const s = q.trim().toLowerCase();
    if (s) l = l.filter((t) => `${t.name} ${t.symbol} ${t.address} ${t.pair.symbol}`.toLowerCase().includes(s));
    if (filter !== "all") l = l.filter((t) => kindOf(t.pair.isNative, t.pair.address, t.pair.v3Fee) === filter);
    l.sort((a, b) => (desc ? key(b) - key(a) : key(a) - key(b)));
    l.sort((a, b) => Number(isPinned(b.address)) - Number(isPinned(a.address)));
    return l;
  }, [tokens, q, filter, sort, desc]);
  const head = (k: Col) => () => { if (sort === k) setDesc(!desc); else { setSort(k); setDesc(true); } };
  const arrow = (k: Col) => (sort === k ? (desc ? " ↓" : " ↑") : "");

  // Pairs by activity, for the row of pair pills under the table.
  const pairs = useMemo(() => {
    const m = new Map<string, { sym: string; kind: string; coins: number; paid: number }>();
    for (const t of tokens ?? []) {
      const k = t.pair.address.toLowerCase();
      const e = m.get(k) ?? { sym: t.pair.symbol, kind: kindOf(t.pair.isNative, t.pair.address, t.pair.v3Fee), coins: 0, paid: 0 };
      e.coins++; e.paid += paidUsd(t); m.set(k, e);
    }
    for (const x of approved) {
      const k = x.address.toLowerCase();
      if (!m.has(k) && (x.isNative || isTokenPair(x.address) || x.v3Fee)) m.set(k, { sym: x.symbol, kind: kindOf(x.isNative, x.address, x.v3Fee), coins: 0, paid: 0 });
    }
    return [...m.values()].sort((a, b) => b.coins - a.coins || b.paid - a.paid).slice(0, 10);
  }, [tokens, approved]);
  const nStocks = approved.filter((x) => !x.isNative && !isTokenPair(x.address) && !x.v3Fee).length;

  return (
    <main>
      <section className="hero">
        <div className="eyebrow-line"><span className="dot live" />Live on Ethereum · Uniswap V4</div>
        <h1 className="display">Launch a coin paired with <span>anything</span>.</h1>
        <p>Pick ETH, UNI, PEPE, a tokenized stock, or any ERC-20 with a Uniswap pool. Every trade pays {FEES.taxPct}%, and {FEES.holderPct}% of it goes to holders in that asset, the moment the trade settles.</p>
        <div className="cta"><Link to="/launch" className="b pri lg">Launch a coin</Link><Link to="/docs" className="b lg">How it works</Link></div>
      </section>

      <div className="feats">
        <div className="feat t1"><div className="ic"><Icon name="bolt" size={20} /></div><h3>Pair with anything</h3><p>ETH, listed tokens, {nStocks} tokenized stocks, or paste any token address. The coin is priced in it and pays in it.</p></div>
        <div className="feat t2"><div className="ic"><Icon name="wallet" size={20} /></div><h3>Holders get paid every trade</h3><p>No staking, no harvest. Rewards accrue in the pair asset as each trade settles. Claim any time, even as ETH.</p><FeeBar compact /></div>
        <div className="feat t3"><div className="ic"><Icon name="shield" size={20} /></div><h3>Fair by construction</h3><p>Fixed 1B supply, $3,000 opening cap, liquidity burned at launch. A 30-second anti-snipe fee and 1% wallet cap protect the open.</p></div>
      </div>

      {DEPLOYED && (
        <div className="stats4">
          <div className="stat"><span>Paid to holders</span><b className="vi">{usd(totals.paid, { compact: true })}</b><small>lifetime, in pair assets</small></div>
          <div className="stat"><span>24h volume</span><b>{usd(totals.vol, { compact: true })}</b><small>across every coin</small></div>
          <div className="stat"><span>Coins</span><b>{num(totals.n, 0)}</b><small>launched on the factory</small></div>
          <div className="stat"><span>Holders</span><b>{num(totals.holders, 0)}</b><small>earning right now</small></div>
        </div>
      )}

      <div className="toolbar">
        <h2>Coins</h2>
        <div className="seg">
          {(["all", "eth", "token", "stock"] as Filter[]).map((f) => <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>{f === "all" ? "All" : f === "eth" ? "ETH" : f === "token" ? "Tokens" : "Stocks"}</button>)}
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
                <th>#</th>
                <th><button className={sort === "new" ? "on" : ""} onClick={head("new")}>Coin{arrow("new")}</button></th>
                <th>Pays in</th>
                <th className="r"><button className={sort === "price" ? "on" : ""} onClick={head("price")}>Price{arrow("price")}</button></th>
                <th className="r c-hide-sm"><button className={sort === "chg" ? "on" : ""} onClick={head("chg")}>1D{arrow("chg")}</button></th>
                <th className="r"><button className={sort === "mcap" ? "on" : ""} onClick={head("mcap")}>Market cap{arrow("mcap")}</button></th>
                <th className="r c-hide-md"><button className={sort === "vol" ? "on" : ""} onClick={head("vol")}>Volume{arrow("vol")}</button></th>
                <th className="r c-hide-md c-hide-lg"><button className={sort === "holders" ? "on" : ""} onClick={head("holders")}>Holders{arrow("holders")}</button></th>
                <th className="r c-hide-sm"><button className={sort === "paid" ? "on" : ""} onClick={head("paid")}>Paid to holders{arrow("paid")}</button></th>
                <th className="c-hide-md spark-h">1D trend</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && <tr><td colSpan={10}><div className="empty">{tokens?.length ? "No coins match." : "No coins yet."}</div></td></tr>}
              {list.map((t, i) => {
                const c = t.priceChange24hPct;
                const kind = kindOf(t.pair.isNative, t.pair.address, t.pair.v3Fee);
                return (
                  <tr key={t.address} className="link" onClick={() => nav(`/t/${t.address}`)}>
                    <td className="faint">{i + 1}</td>
                    <td><Link to={`/t/${t.address}`} className="coin" onClick={(e) => e.stopPropagation()}>
                      <Art src={t.metadata?.logo} name={t.name} className="art" />
                      <span style={{ minWidth: 0 }}><b>{t.name}</b><small><span>{t.symbol}</span>{isPinned(t.address) && <span className="chip official" style={{ height: 20, fontSize: 11 }}>Official</span>}<span>{ago(t.createdAt)}</span></small></span>
                    </Link></td>
                    <td><span className={"chip pair " + kind}><i className={"av " + kind}>{t.pair.symbol.replace(/on$/, "").slice(0, 4)}</i>{t.pair.symbol}</span></td>
                    <td className="r">{usd(t.priceUsd)}</td>
                    <td className="r c-hide-sm"><span className={"pill " + (c == null ? "" : c >= 0 ? "up" : "down")}>{c == null ? "new" : pct(c)}</span></td>
                    <td className="r">{usd(t.marketCapUsd, { compact: true })}</td>
                    <td className="r c-hide-md">{usd(volUsd(t), { compact: true })}</td>
                    <td className="r c-hide-md c-hide-lg">{num(t.holderCount, 0)}</td>
                    <td className="r c-hide-sm">{usd(paidUsd(t), { compact: true })}<small>{t.rewards ? `${num(wei(t.rewards.holders, t.pair.decimals), 4)} ${t.pair.symbol}` : "—"}</small></td>
                    <td className="c-hide-md spark-c"><Spark token={t.address} up={c == null ? null : c >= 0} width={100} height={32} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {DEPLOYED && pairs.length > 0 && (
        <div className="pairs-row">
          {pairs.map((p) => (
            <Link key={p.sym} to="/launch"><span className={"av " + p.kind}>{p.sym.replace(/on$/, "").slice(0, 4)}</span>{p.sym}<small>{p.coins === 0 ? "no coins yet" : `${p.coins} coin${p.coins === 1 ? "" : "s"} · ${usd(p.paid, { compact: true })} paid`}</small></Link>
          ))}
          <Link to="/launch" className="b soft" style={{ height: 40 }}>+ Any ERC-20</Link>
        </div>
      )}
    </main>
  );
}
