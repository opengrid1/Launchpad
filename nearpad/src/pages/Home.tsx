import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { Art } from "../components/Art";
import { Menu } from "../components/Menu";
import { Ring } from "../components/Ring";
import { DEPLOYED, PINNED } from "../lib/env";
import { ago, units } from "../lib/format";
import { useCoins, useCurrency, useNearUsd } from "../lib/hooks";
import type { Coin } from "../lib/types";
import { pairSymbol } from "../lib/types";
import { makeValuer, pairKind, progress } from "../lib/value";

type Sort = "trending" | "mcap" | "progress" | "holders" | "new";

export default function Home() {
  const { data: coins, isLoading } = useCoins();
  const { data: nearUsd = 0 } = useNearUsd();
  const [ccy] = useCurrency();
  const val = useMemo(() => makeValuer(ccy, nearUsd), [ccy, nearUsd]);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"live" | "new" | "graduated">("live");
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
    if (tab === "graduated") l = l.filter((c) => c.info.phase === "Pool");
    if (tab === "live") l = l.filter((c) => c.info.phase !== "Pool");
    const key = (c: Coin) => {
      switch (tab === "new" ? "new" : sort) {
        case "new": return c.created_at_ms;
        case "mcap": return units(c.info.market_cap, 24);
        case "progress": return progress(c);
        case "holders": return c.info.holders;
        default: return c.info.trades * 1000 + c.info.holders;
      }
    };
    l.sort((a, b) => key(b) - key(a));
    l.sort((a, b) => Number(PINNED.includes(b.account_id)) - Number(PINNED.includes(a.account_id)));
    return l;
  }, [coins, q, tab, sort]);

  const closest = useMemo(() => (coins ?? []).filter((c) => c.info.phase === "Curve").sort((a, b) => progress(b) - progress(a)).slice(0, 6), [coins]);
  const totals = useMemo(() => {
    const t = coins ?? [];
    return { n: t.length, holders: t.reduce((s, c) => s + c.info.holders, 0), paid: t.filter((c) => c.info.pair === "Near").reduce((s, c) => s + units(c.info.dividends_total, 24), 0) };
  }, [coins]);

  return (
    <main>
      <div className="row-flex" style={{ marginBottom: 12 }}>
        <input className="in" placeholder="Search coins" value={q} onChange={(e) => setQ(e.target.value)} style={{ height: 42 }} />
      </div>
      {DEPLOYED && coins && coins.length > 0 && (
        <div className="pulse">
          <div><span>Coins</span><b className="num">{totals.n}</b></div>
          <div><span>Holders</span><b className="num">{totals.holders.toLocaleString()}</b></div>
          <div><span>Paid out</span><b className="num">{ccy === "USD" && nearUsd > 0 ? `$${(totals.paid * nearUsd).toFixed(0)}` : `${totals.paid.toFixed(1)} Ⓝ`}</b></div>
        </div>
      )}

      {closest.length > 0 && (
        <>
          <div className="sec"><h2>Closest to graduation</h2><span className="eyebrow">curve sold</span></div>
          <div className="scroll-x">
            {closest.map((c) => (
              <Link key={c.account_id} to={`/t/${c.account_id}`} className="spot">
                <div className="t"><Art src={c.info.icon ?? undefined} name={c.name} className="art" size={40} /><div style={{ minWidth: 0, flex: 1 }}><b>{c.symbol}</b><small>{c.name} · {ago(c.created_at_ms)}</small></div><Ring pct={progress(c)} size={44} /></div>
                <div className="m"><span className="mc">{val(c.info.pair).fmt(c.info.market_cap, true)}<small>market cap</small></span><span className={"chip " + pairKind(c.info.pair)}>{pairSymbol(c.info.pair)}</span></div>
              </Link>
            ))}
          </div>
        </>
      )}


      <div className="filters">
        <div className="seg">
          {(["live", "new", "graduated"] as const).map((t) => <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t === "live" ? "On the curve" : t[0].toUpperCase() + t.slice(1)}</button>)}
        </div>
        {tab !== "new" && (
          <Menu<Sort> value={sort} onChange={setSort} label="Sort" options={[{ v: "trending", l: "Most traded" }, { v: "mcap", l: "Market cap" }, { v: "progress", l: "Progress" }, { v: "holders", l: "Holders" }, { v: "new", l: "Newest" }]} />
        )}
      </div>

      {!DEPLOYED ? (
        <div className="card"><div className="empty">The factory is not on NEAR yet.</div></div>
      ) : isLoading && !coins ? (
        <div className="skel" style={{ height: 380 }} />
      ) : (
        <div className="rows">
          {list.length === 0 && (coins?.length ? <div className="empty">No coins match.</div> : (
            <div className="empty-hero">
              <img src="/logo.svg" alt="" />
              <h3>No coins yet. <em>Yours could be the first.</em></h3>
              <p>Name it, pick where the tax goes, and launch. Holders get paid on every trade, and the coin graduates to Rhea.</p>
              <Link to="/create" className="b pri">Create a coin</Link>
            </div>
          ))}
          {list.map((c) => {
            const v = val(c.info.pair);
            const pool = c.info.phase === "Pool";
            const kind = pairKind(c.info.pair);
            return (
              <Link key={c.account_id} to={`/t/${c.account_id}`} className="row">
                <Art src={c.info.icon ?? undefined} name={c.name} className="art" />
                <div className="nm">
                  <b>{c.symbol}<span className="pr">/ {pairSymbol(c.info.pair)}</span>{PINNED.includes(c.account_id) && <span className="chip official" style={{ height: 18, fontSize: 10 }}>Official</span>}</b>
                  <small><span>{c.name}</span><span className="dot">· {ago(c.created_at_ms)}</span><span className="dot">· {c.info.holders} holders</span>{pool && <span className="up dot" style={{ fontWeight: 700 }}>· graduated</span>}</small>
                  <div className={"bar" + (pool ? " pool" : "")}><i style={{ width: `${progress(c)}%` }} /></div>
                </div>
                <div className="px">
                  <b>{v.fmt(c.info.market_cap, true)}</b>
                  <small className={kind === "near" ? "" : kind}>{c.info.buy_tax_bps / 100}% / {c.info.sell_tax_bps / 100}% tax</small>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
