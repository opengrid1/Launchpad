import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { Art } from "../components/Art";
import { DEPLOYED, PINNED } from "../lib/env";
import { ago, units } from "../lib/format";
import { useCoins, useCurrency, useNearUsd, usePairs } from "../lib/hooks";
import type { Coin } from "../lib/types";
import { pairSymbol } from "../lib/types";
import { makeValuer, pairKind, progress } from "../lib/value";

type Sort = "trending" | "new" | "mcap" | "progress" | "holders";

export default function Home() {
  const { data: coins, isLoading } = useCoins();
  const { data: pairs } = usePairs();
  const { data: nearUsd = 0 } = useNearUsd();
  const [ccy] = useCurrency();
  const val = useMemo(() => makeValuer(ccy, nearUsd), [ccy, nearUsd]);
  const [q, setQ] = useState("");
  const [pair, setPair] = useState<string>("all");
  const [tab, setTab] = useState<"trending" | "new" | "graduated">("trending");
  const [sort, setSort] = useState<Sort>("trending");
  useEffect(() => {
    const on = (e: Event) => setQ(String((e as CustomEvent).detail ?? ""));
    window.addEventListener("nearpad:search", on);
    return () => window.removeEventListener("nearpad:search", on);
  }, []);

  const list = useMemo(() => {
    let l = (coins ?? []).slice();
    const s = q.trim().toLowerCase();
    if (s) l = l.filter((c) => `${c.name} ${c.symbol} ${c.account_id} ${c.creator}`.toLowerCase().includes(s));
    if (pair !== "all") l = l.filter((c) => c.pair === pair);
    if (tab === "graduated") l = l.filter((c) => c.info.phase === "Pool");
    if (tab === "new") l.sort((a, b) => b.created_at_ms - a.created_at_ms);
    else {
      const key = (c: Coin) => {
        switch (sort) {
          case "new": return c.created_at_ms;
          case "mcap": return units(c.info.market_cap, 24);
          case "progress": return progress(c);
          case "holders": return c.info.holders;
          default: return c.info.trades * 1000 + c.info.holders;
        }
      };
      l.sort((a, b) => key(b) - key(a));
    }
    l.sort((a, b) => Number(PINNED.includes(b.account_id)) - Number(PINNED.includes(a.account_id)));
    return l;
  }, [coins, q, pair, tab, sort]);

  const featured = useMemo(() => (coins ?? []).slice().sort((a, b) => b.info.trades - a.info.trades)[0], [coins]);
  const closest = useMemo(() => (coins ?? []).filter((c) => c.info.phase === "Curve").sort((a, b) => progress(b) - progress(a)).slice(0, 5), [coins]);
  const totals = useMemo(() => {
    const t = coins ?? [];
    return { n: t.length, holders: t.reduce((s, c) => s + c.info.holders, 0), trades: t.reduce((s, c) => s + c.info.trades, 0) };
  }, [coins]);

  return (
    <main>
      {featured && (
        <section className="hero-near">
          <Link to={`/t/${featured.account_id}`} className="card" style={{ display: "block", color: "inherit", padding: 20 }}>
            <div className="ccard-top" style={{ display: "flex", gap: 14, alignItems: "center" }}>
              <Art src={featured.info.icon ?? undefined} name={featured.name} className="art" size={64} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{featured.symbol} <span className="faint" style={{ fontWeight: 500, fontSize: 15 }}>{featured.name}</span></div>
                <div className="who" style={{ marginTop: 4 }}><span className={"phase " + (featured.info.phase === "Pool" ? "pool" : "")}>{featured.info.phase === "Pool" ? "Graduated" : `${progress(featured).toFixed(0)}% on the curve`}</span> <span className="faint">{ago(featured.created_at_ms)}</span></div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 26, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{val(featured.info.pair).fmt(featured.info.market_cap, true)}</div>
                <div className="faint" style={{ fontSize: 13 }}>market cap</div>
              </div>
            </div>
            <div className="ccard" style={{ border: 0, padding: 0, marginTop: 14 }}>
              <div className="stats" style={{ borderTop: "1px solid var(--line)" }}>
                <div><span>Holders</span><b>{featured.info.holders.toLocaleString()}</b></div>
                <div><span>Trades</span><b>{featured.info.trades.toLocaleString()}</b></div>
                <div><span>Paid to holders</span><b className="vi">{val(featured.info.pair).fmt(featured.info.dividends_total, true)}</b></div>
              </div>
            </div>
          </Link>
          <div className="card" style={{ padding: 18 }}>
            <div className="sec-h" style={{ margin: "0 0 12px" }}><h2 style={{ fontSize: 16 }}>Closest to graduation</h2><span className="eyebrow">Curve sold</span></div>
            <div className="top5">
              {closest.length === 0 && <div className="faint" style={{ fontSize: 14 }}>Every coin has graduated.</div>}
              {closest.map((c, i) => (
                <Link key={c.account_id} to={`/t/${c.account_id}`}>
                  <span className="n">{i + 1}</span>
                  <Art src={c.info.icon ?? undefined} name={c.name} className="art" size={32} />
                  <span style={{ minWidth: 0 }}><b>{c.symbol} <span className="faint" style={{ fontWeight: 500 }}>/ {pairSymbol(c.info.pair)}</span></b><small>{val(c.info.pair).fmt(c.info.market_cap, true)}</small></span>
                  <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, fontSize: 13 }}><span className="bar"><i style={{ width: `${progress(c)}%` }} /></span>{progress(c).toFixed(0)}%</span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      <div className="pairs-row">
        <button className={pair === "all" ? "on" : ""} onClick={() => setPair("all")}>All</button>
        {(pairs ?? []).map((p) => <button key={p.key} className={pair === p.key ? "on" : ""} onClick={() => setPair(p.key)}><span className="av">{p.key.slice(0, 2).toUpperCase()}</span>{p.name}</button>)}
      </div>

      <div className="filters" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div className="seg">
          {(["trending", "new", "graduated"] as const).map((t) => <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}
        </div>
        <select className="in" style={{ width: "auto", height: 36 }} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="trending">Sort: Most traded</option>
          <option value="mcap">Sort: Market cap</option>
          <option value="progress">Sort: Progress</option>
          <option value="holders">Sort: Holders</option>
          <option value="new">Sort: Newest</option>
        </select>
      </div>

      {!DEPLOYED ? (
        <div className="card"><div className="empty">The factory is not on NEAR yet.</div></div>
      ) : isLoading && !coins ? (
        <div className="skel" style={{ height: 420 }} />
      ) : (
        <div className="cards" style={{ marginTop: 14 }}>
          {list.length === 0 && <div className="empty">{coins?.length ? "No coins match." : "No coins yet. Create the first one."}</div>}
          {list.map((c) => {
            const v = val(c.info.pair);
            const kind = pairKind(c.info.pair);
            const pool = c.info.phase === "Pool";
            return (
              <Link key={c.account_id} to={`/t/${c.account_id}`} className="ccard">
                <div className="top">
                  <Art src={c.info.icon ?? undefined} name={c.name} className="art" size={44} />
                  <div className="nm">
                    <b>{c.symbol}{!(c.info.pair === "Near") && <span className="pr">/ {pairSymbol(c.info.pair)}</span>}{PINNED.includes(c.account_id) && <span className="chip official" style={{ height: 18, fontSize: 10 }}>Official</span>}</b>
                    <small>{c.name}</small>
                  </div>
                  <div className="px"><b>{v.fmt(c.info.market_cap, true)}</b><small className={"chip " + kind} style={{ height: 18, fontSize: 10 }}>{pairSymbol(c.info.pair)}</small></div>
                </div>
                <div className="who"><span>{c.creator}</span><span>·</span><span>{ago(c.created_at_ms)}</span>{pool && <><span>·</span><span className="grad">Graduated</span></>}</div>
                <div className="prog"><i style={{ width: `${progress(c)}%`, background: pool ? "var(--accent)" : undefined }} /></div>
                <div className="prog-l"><span>{pool ? "Pool open" : "Curve"}</span><b>{progress(c).toFixed(0)}%</b></div>
                <div className="stats">
                  <div><span>Raised</span><b>{v.fmt(pool ? c.info.pool_pair : c.info.raised, true)}</b></div>
                  <div><span>Holders</span><b>{c.info.holders.toLocaleString()}</b></div>
                  <div><span>Tax</span><b>{c.info.buy_tax_bps / 100}% / {c.info.sell_tax_bps / 100}%</b></div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {DEPLOYED && coins && coins.length > 0 && (
        <p className="note" style={{ marginTop: 18 }}>{totals.n} coins · {totals.holders.toLocaleString()} holders · {totals.trades.toLocaleString()} trades. Every trade pays the creator's tax; the platform keeps 20% and the creator's four shares divide the rest.</p>
      )}
    </main>
  );
}
