import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { Tape } from "../App";
import { Art } from "../components/Art";
import { Icon } from "../components/Icon";
import { DEPLOYED, isMain, listed } from "../lib/env";
import { num, pct, usd, wei } from "../lib/format";
import { useTokens, type Token } from "../lib/hooks";

type Filter = "hot" | "new" | "stock" | "eth";

/** The coin list: filters, search, one row per coin. */
export default function Home() {
  const { data: all, isLoading } = useTokens();
  const [params] = useSearchParams();
  const [filter, setFilter] = useState<Filter>("hot");
  const [q, setQ] = useState(params.get("q") ?? "");
  const inp = useRef<HTMLInputElement>(null);
  useEffect(() => { setQ(params.get("q") ?? ""); if (params.get("focus")) inp.current?.focus(); }, [params]);

  const list = useMemo(() => {
    let l = (all ?? []).filter(listed);
    const s = q.trim().toLowerCase();
    if (s) l = l.filter((t) => `${t.name} ${t.symbol} ${t.address} ${t.pair.symbol}`.toLowerCase().includes(s));
    if (filter === "eth") l = l.filter((t) => t.pair.isNative);
    if (filter === "stock") l = l.filter((t) => !t.pair.isNative);
    if (filter === "new") l.sort((a, b) => b.createdAt - a.createdAt);
    else l.sort((a, b) => wei(b.volume24hWei) * b.pair.usd - wei(a.volume24hWei) * a.pair.usd || Number(b.marketCapUsd) - Number(a.marketCapUsd));
    l.sort((a, b) => Number(isMain(b.address)) - Number(isMain(a.address)));
    return l;
  }, [all, q, filter]);

  return (
    <main>
      <Tape />
      <div className="sec"><h2>Coins</h2><div className="segs">
        {(["hot", "new", "stock", "eth"] as Filter[]).map((f) => <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>{f === "hot" ? "Hot" : f === "new" ? "New" : f === "stock" ? "Stocks" : "ETH"}</button>)}
      </div></div>
      <label className="msearch"><Icon name="search" size={16} /><input ref={inp} type="search" placeholder="Search coins" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      {!DEPLOYED ? <div className="empty">The factory is not on Ethereum yet.</div>
        : isLoading && !all ? <div className="list">{[0, 1, 2, 3].map((i) => <div key={i} className="skel" style={{ height: 70 }} />)}</div>
        : list.length === 0 ? <div className="empty">{q ? "Nothing matches." : all?.length ? "No coins in this filter." : <>No coins yet. <Link to="/launch">Launch the first one.</Link></>}</div>
        : <div className="list">{list.map((t) => <Row key={t.address} t={t} />)}</div>}
    </main>
  );
}

function Row({ t }: { t: Token }) {
  const c = t.priceChange24hPct;
  const what = t.pair.isNative ? "Rewards in ETH" : `Rewards in ${t.pair.symbol}`;
  return (
    <Link className="row" to={`/t/${t.address}`}>
      <Art src={t.metadata?.logo} address={t.address} />
      <span>
        <span className="name"><b>{t.symbol}</b>{isMain(t.address) && <span className="badge main">MAIN</span>}<span className={"badge " + (t.pair.isNative ? "eth" : "stock")}>{t.pair.symbol}</span></span>
        <span className="what">{isMain(t.address) ? "Earns from every coin" : what} · {num(t.holderCount, 0)} holders</span>
      </span>
      <span className="fig">
        <b>{usd(t.marketCapUsd, { compact: true })}</b>
        <span className={"badge " + (c == null ? "mute" : c >= 0 ? "up" : "down")}>{c == null ? "new" : pct(c)}</span>
        <span className="vol">{usd(wei(t.volume24hWei) * t.pair.usd, { compact: true })} <small>24h</small></span>
      </span>
    </Link>
  );
}
