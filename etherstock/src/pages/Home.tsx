import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { Art } from "../components/Art";
import { DEPLOYED, FEES, isHidden, isPinned } from "../lib/env";
import { ago, cnum, num, pct, usd, wei } from "../lib/format";
import { useQuotes, useTokens, type Token } from "../lib/hooks";

type Col = "new" | "price" | "chg" | "mcap" | "vol" | "holders" | "burned" | "fuse";
const COLS: { k: Col; l: string; cls: string }[] = [
  { k: "price", l: "Price", cls: "c-price r" }, { k: "chg", l: "24h", cls: "c-chg r" }, { k: "mcap", l: "Mcap", cls: "c-mcap r" },
  { k: "vol", l: "Vol 24h", cls: "c-vol r" }, { k: "holders", l: "Holders", cls: "c-hold r" }, { k: "burned", l: "Burned", cls: "c-burn" }, { k: "fuse", l: "Next burn", cls: "c-fuse" },
];

const burnedPct = (t: Token) => (t.burn ? (Number(t.burn.burned) / 1e27) * 100 : 0);
const fusePct = (t: Token) => (t.burn && t.burn.min > 0n ? Math.min(100, (Number(t.burn.reserve) / Number(t.burn.min)) * 100) : 0);

/** The board: one dense screener of every coin, sortable by any column, with
 *  a burned meter and a next-burn fuse on each row. */
export default function Home() {
  const { data: all, isLoading } = useTokens();
  const { data: quotes } = useQuotes();
  const tokens = useMemo(() => all?.filter((t) => !isHidden(t.address)), [all]);
  const [sort, setSort] = useState<Col>("new");
  const [desc, setDesc] = useState(true);
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<"all" | "eth" | "stock">("all");

  const key = (t: Token): number => {
    switch (sort) {
      case "price": return Number(t.priceUsd);
      case "chg": return t.priceChange24hPct ?? -1e9;
      case "mcap": return Number(t.marketCapUsd);
      case "vol": return wei(t.volume24hWei) * t.pair.usd;
      case "holders": return t.holderCount ?? 0;
      case "burned": return burnedPct(t);
      case "fuse": return fusePct(t);
      default: return t.createdAt;
    }
  };
  const list = useMemo(() => {
    let l = (tokens ?? []).slice();
    const s = q.trim().toLowerCase();
    if (s) l = l.filter((t) => `${t.name} ${t.symbol} ${t.address} ${t.pair.symbol}`.toLowerCase().includes(s));
    if (only === "eth") l = l.filter((t) => t.pair.isNative);
    if (only === "stock") l = l.filter((t) => !t.pair.isNative);
    l.sort((a, b) => (desc ? key(b) - key(a) : key(a) - key(b)));
    l.sort((a, b) => Number(isPinned(b.address)) - Number(isPinned(a.address)));
    return l;
  }, [tokens, q, only, sort, desc]);
  const totals = useMemo(() => {
    const t = tokens ?? [];
    return {
      n: t.length,
      vol: t.reduce((s, x) => s + wei(x.volume24hWei) * x.pair.usd, 0),
      burnedCoins: t.reduce((s, x) => s + wei(x.burn?.burned ?? 0n), 0),
      spent: t.reduce((s, x) => s + wei(x.burn?.spent ?? 0n) * x.pair.usd, 0),
    };
  }, [tokens]);
  const stocks = quotes ? quotes.filter((x) => x.approved && !x.isNative).length : 0;
  const head = (k: Col) => () => { if (sort === k) setDesc(!desc); else { setSort(k); setDesc(true); } };

  return (
    <main>
      <section className="band">
        <div>
          <h1>Every trade <em>burns</em> the coin.</h1>
          <p>Coins on Ethereum paired with ETH or {stocks > 0 ? `one of ${stocks} tokenized stocks` : "a tokenized stock"}. {FEES.taxPct}% on each trade: {FEES.creatorPct}% to the creator, {FEES.burnPct}% buys the coin back from its own pool and burns it, {FEES.platformPct}% to the platform. Supply only goes down.</p>
          <div className="cta"><Link to="/launch" className="b fire lg">Launch a coin</Link><Link to="/docs" className="b lg">Read the rules</Link></div>
        </div>
        <div className="figs">
          <div><span className="lbl">Burned so far</span><b className="bignum">{cnum(totals.burnedCoins)}</b><span className="lbl">coins · {usd(totals.spent, { compact: true })} spent</span></div>
          <div><span className="lbl">Volume 24h</span><b>{usd(totals.vol, { compact: true })}</b></div>
          <div><span className="lbl">Coins live</span><b>{num(totals.n, 0)}</b></div>
        </div>
      </section>

      {!DEPLOYED ? (
        <div className="scr"><div className="empty">The factory is not on Ethereum yet. Check back shortly.</div></div>
      ) : (
        <>
          <div className="tools">
            <div className="seg">
              <button className={only === "all" ? "on" : ""} onClick={() => setOnly("all")}>All</button>
              <button className={only === "stock" ? "on" : ""} onClick={() => setOnly("stock")}>Stock pairs</button>
              <button className={only === "eth" ? "on" : ""} onClick={() => setOnly("eth")}>ETH pairs</button>
            </div>
            <input className="in grow" placeholder="Search name, ticker, pair or address" value={q} onChange={(e) => setQ(e.target.value)} />
            <span className="count">{list.length} of {totals.n} · sorted by {sort === "new" ? "newest" : COLS.find((c) => c.k === sort)?.l.toLowerCase()} {desc ? "↓" : "↑"}</span>
          </div>
          <div className="scr">
            <div className="scr-h">
              <span />
              <button className={sort === "new" ? "on" : ""} onClick={head("new")}>Coin {sort === "new" ? (desc ? "↓" : "↑") : ""}</button>
              {COLS.map((c) => <button key={c.k} className={c.cls + (sort === c.k ? " on" : "")} onClick={head(c.k)}>{c.l} {sort === c.k ? (desc ? "↓" : "↑") : ""}</button>)}
            </div>
            {isLoading && !tokens ? [0, 1, 2, 3].map((i) => <div key={i} className="skel" style={{ height: 60, margin: 8 }} />)
              : list.length === 0 ? <div className="empty">{q ? "Nothing matches." : "No coins yet. Be the first."}</div>
              : list.map((t, i) => <Row key={t.address} t={t} i={i} />)}
          </div>
        </>
      )}
    </main>
  );
}

function Row({ t, i }: { t: Token; i: number }) {
  const c = t.priceChange24hPct;
  const burned = burnedPct(t);
  const fuse = fusePct(t);
  const reserveUsd = wei(t.burn?.reserve ?? 0n) * t.pair.usd;
  return (
    <Link to={`/t/${t.address}`} className="scr-r" style={{ animationDelay: `${Math.min(i, 14) * 25}ms` }}>
      <span className="idx">{String(i + 1).padStart(2, "0")}</span>
      <span className="who">
        <Art src={t.metadata?.logo} name={t.name} className="art" />
        <span style={{ minWidth: 0 }}>
          <b>{t.name}</b>
          <small><span className="sym">{t.symbol}</span>{isPinned(t.address) && <span className="chip official">official</span>}<span className={"chip " + (t.pair.isNative ? "eth" : "stock")}>{t.pair.symbol}</span><span>{ago(t.createdAt)}</span></small>
        </span>
      </span>
      <span className="n c-price">{usd(t.priceUsd)}</span>
      <span className={"n c-chg " + (c == null ? "faint" : c >= 0 ? "up" : "down")}>{c == null ? "new" : pct(c)}</span>
      <span className="n c-mcap">{usd(t.marketCapUsd, { compact: true })}<small className={c == null ? "" : c >= 0 ? "up" : "down"}>{c == null ? "new" : pct(c)}</small></span>
      <span className="n c-vol">{usd(wei(t.volume24hWei) * t.pair.usd, { compact: true })}</span>
      <span className="n c-hold">{num(t.holderCount, 0)}</span>
      <span className="meter c-burn">
        <span className="meter-h"><b className={burned > 0 ? "" : "zero"}>{burned.toFixed(2)}%</b><span>{cnum(wei(t.burn?.burned ?? 0n))} burned</span></span>
        <span className="meter-bar"><i style={{ width: `${Math.min(100, burned * 4)}%` }} /></span>
      </span>
      <span className="meter c-fuse">
        <span className="meter-h"><b className={fuse >= 100 ? "" : "zero"}>{fuse >= 100 ? "armed" : `${fuse.toFixed(0)}%`}</b><span>{usd(reserveUsd)} in reserve</span></span>
        <span className="meter-bar"><i className={"fuse" + (fuse >= 100 ? " hot" : "")} style={{ width: `${fuse}%` }} /></span>
      </span>
    </Link>
  );
}
