import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Art } from "../components/Art";
import { Glyph } from "../components/Glyph";
import { Spark } from "../components/Spark";
import { DEPLOYED, FEES, isHidden, isPinned } from "../lib/env";
import { ago, num, pct, usd, wei } from "../lib/format";
import { useTokens, type Token } from "../lib/hooks";
import { isTokenPair } from "../lib/stocks";

const paidUsd = (t: Token) => (t.rewards ? wei(t.rewards.holders, t.pair.decimals) * t.pair.usd : 0);
const volUsd = (t: Token) => wei(t.volume24hWei, t.pair.decimals) * t.pair.usd;
const kindOf = (isNative: boolean, addr: string, v3Fee?: number) => (isNative ? "eth" : isTokenPair(addr) || v3Fee ? "token" : "stock");

type Col = "new" | "price" | "chg" | "mcap" | "vol" | "paid";
type Filter = "all" | "eth" | "token" | "stock";

export default function Home() {
  const nav = useNavigate();
  const { data: all, isLoading } = useTokens();
  const tokens = useMemo(() => all?.filter((t) => !isHidden(t.address)), [all]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Col>("mcap");
  const [desc, setDesc] = useState(true);
  useEffect(() => {
    const on = (e: Event) => setQ(String((e as CustomEvent).detail ?? ""));
    window.addEventListener("alicorn:search", on);
    return () => window.removeEventListener("alicorn:search", on);
  }, []);

  const totals = useMemo(() => {
    const t = tokens ?? [];
    return { n: t.length, vol: t.reduce((s, x) => s + volUsd(x), 0), paid: t.reduce((s, x) => s + paidUsd(x), 0), holders: t.reduce((s, x) => s + (x.holderCount ?? 0), 0) };
  }, [tokens]);

  const key = (t: Token): number => {
    switch (sort) {
      case "price": return Number(t.priceUsd);
      case "chg": return t.priceChange24hPct ?? -1e9;
      case "mcap": return Number(t.marketCapUsd);
      case "vol": return volUsd(t);
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
  const movers = useMemo(() => (tokens ?? []).filter((t) => t.priceChange24hPct != null).sort((a, b) => Math.abs(b.priceChange24hPct!) - Math.abs(a.priceChange24hPct!)).slice(0, 4), [tokens]);

  return (
    <main>
      <section className="summary">
        <div className="sum-main">
          <div className="lbl">Paid to holders</div>
          <div className="big">{DEPLOYED ? usd(totals.paid, { compact: totals.paid >= 1e6 }) : "$0.00"}</div>
          <div className="fee"><span className="chip">{FEES.holderPct}% of every {FEES.taxPct}% trade fee</span><span className="faint">paid in the pair asset, every trade</span></div>
          <div className="cta"><Link to="/launch" className="b pri">Launch a coin</Link><Link to="/docs" className="b">How it works</Link></div>
        </div>
        <div className="sum-tiles">
          <div><div className="ic"><Glyph name="chart" size={20} /></div><span>24h volume</span><b>{usd(totals.vol, { compact: true })}</b></div>
          <div><div className="ic gold"><Glyph name="coins" size={20} /></div><span>Coins</span><b>{num(totals.n, 0)}</b></div>
          <div><div className="ic violet"><Glyph name="users" size={20} /></div><span>Holders</span><b>{num(totals.holders, 0)}</b></div>
        </div>
      </section>

      {DEPLOYED && movers.length > 0 && (
        <>
          <div className="sec-h"><h2>Top movers</h2><span className="eyebrow">Last 24 hours</span></div>
          <div className="movers">
            {movers.map((t) => {
              const c = t.priceChange24hPct!;
              return (
                <Link key={t.address} to={`/t/${t.address}`} className="mover">
                  <div className="top"><Art src={t.metadata?.logo} name={t.name} className="art" size={36} /><div style={{ minWidth: 0 }}><b>{t.name}</b><small>{t.symbol} · pays {t.pair.symbol}</small></div></div>
                  <div className="px"><b>{usd(t.priceUsd)}</b><span className={"chg " + (c >= 0 ? "up" : "down")} style={{ fontWeight: 600, fontSize: 13 }}>{pct(c)}</span></div>
                </Link>
              );
            })}
          </div>
        </>
      )}

      <div className="sec-h"><h2>All coins</h2></div>
      <div className="filters">
        <div className="seg">
          {(["all", "eth", "token", "stock"] as Filter[]).map((f) => <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>{f === "all" ? "All" : f === "eth" ? "Pays ETH" : f === "token" ? "Pays tokens" : "Pays stocks"}</button>)}
        </div>
      </div>

      {!DEPLOYED ? (
        <div className="card"><div className="empty">The factory is not on Ethereum yet.</div></div>
      ) : isLoading && !tokens ? (
        <div className="skel" style={{ height: 420 }} />
      ) : (
        <div className="list">
          <div className="rowh">
            <button className={sort === "new" ? "on" : ""} onClick={head("new")}>Name{arrow("new")}</button>
            <span>Pays in</span>
            <span />
            <button className={"r " + (sort === "price" ? "on" : "")} onClick={head("price")}>Price{arrow("price")}</button>
            <button className={"r " + (sort === "mcap" ? "on" : "")} onClick={head("mcap")}>Market cap{arrow("mcap")}</button>
            <button className={"r " + (sort === "paid" ? "on" : "")} onClick={head("paid")}>Paid to holders{arrow("paid")}</button>
          </div>
          {list.length === 0 && <div className="empty">{tokens?.length ? "No coins match." : "No coins yet."}</div>}
          {list.map((t) => {
            const c = t.priceChange24hPct;
            const kind = kindOf(t.pair.isNative, t.pair.address, t.pair.v3Fee);
            return (
              <div key={t.address} className="rowc" onClick={() => nav(`/t/${t.address}`)} role="link" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") nav(`/t/${t.address}`); }}>
                <div className="coin">
                  <Art src={t.metadata?.logo} name={t.name} className="art" />
                  <div style={{ minWidth: 0 }}><b>{t.name}</b><small><span>{t.symbol}</span>{isPinned(t.address) && <span className="chip official" style={{ height: 20, fontSize: 11 }}>Official</span>}<span>{ago(t.createdAt)}</span></small></div>
                </div>
                <div className="c-hide-sm"><span className={"chip pair " + kind}><i className={"av " + kind}>{t.pair.symbol.replace(/on$/, "").slice(0, 4)}</i>{t.pair.symbol}</span></div>
                <div className="c-hide-sm c-hide-md"><Spark token={t.address} up={c == null ? null : c >= 0} width={100} height={32} /></div>
                <div className="r"><span>{usd(t.priceUsd)}</span><small className={"chg " + (c == null ? "" : c >= 0 ? "up" : "down")}>{c == null ? "new" : pct(c)}</small></div>
                <div className="r c-hide-sm"><span>{usd(t.marketCapUsd, { compact: true })}</span><small>{usd(volUsd(t), { compact: true })} vol</small></div>
                <div className="r c-hide-sm"><span className="vi">{usd(paidUsd(t), { compact: true })}</span><small>{t.rewards ? `${num(wei(t.rewards.holders, t.pair.decimals), 4)} ${t.pair.symbol}` : "—"}</small></div>
              </div>
            );
          })}
        </div>
      )}

    </main>
  );
}
