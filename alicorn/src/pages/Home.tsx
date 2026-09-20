import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { Art } from "../components/Art";
import { DEPLOYED, FEES, isHidden, isPinned } from "../lib/env";
import { ago, num, pct, usd, wei } from "../lib/format";
import { useQuotes, useTokens, type Token } from "../lib/hooks";
import { isTokenPair } from "../lib/stocks";

const paidUsd = (t: Token) => (t.rewards ? wei(t.rewards.holders) * t.pair.usd : 0);
const kindOf = (isNative: boolean, addr: string) => (isNative ? "eth" : isTokenPair(addr) ? "token" : "stock");

type Col = "new" | "price" | "chg" | "mcap" | "vol" | "holders" | "paid";
const COLS: { k: Col; l: string; cls: string }[] = [
  { k: "price", l: "Price", cls: "c-price r" }, { k: "chg", l: "24h", cls: "c-chg r" }, { k: "mcap", l: "Mcap", cls: "c-mcap r" },
  { k: "vol", l: "Vol 24h", cls: "c-vol r" }, { k: "holders", l: "Holders", cls: "c-hold r" }, { k: "paid", l: "Paid out", cls: "c-paid r" },
];

/** The board. Coins are filed in lanes under the asset they pay holders in,
 *  because that is the whole point: what you get paid in. A search flattens
 *  the lanes into one sortable list. */
export default function Home() {
  const { data: all, isLoading } = useTokens();
  const { data: quotes } = useQuotes();
  const tokens = useMemo(() => all?.filter((t) => !isHidden(t.address)), [all]);
  const [q, setQ] = useState("");
  const [view, setView] = useState<"lanes" | "list">("lanes");
  const [sort, setSort] = useState<Col>("new");
  const [desc, setDesc] = useState(true);

  const totals = useMemo(() => {
    const t = tokens ?? [];
    return { n: t.length, vol: t.reduce((s, x) => s + wei(x.volume24hWei) * x.pair.usd, 0), paid: t.reduce((s, x) => s + paidUsd(x), 0), holders: t.reduce((s, x) => s + (x.holderCount ?? 0), 0) };
  }, [tokens]);
  const approved = useMemo(() => (quotes ?? []).filter((x) => x.approved), [quotes]);

  // Lanes: every pair asset that has coins, ETH first, then by what it has paid out.
  const lanes = useMemo(() => {
    const m = new Map<string, { pair: Token["pair"]; coins: Token[]; paidUsd: number; paidPair: number }>();
    for (const t of tokens ?? []) {
      const k = t.pair.address.toLowerCase();
      const l = m.get(k) ?? { pair: t.pair, coins: [], paidUsd: 0, paidPair: 0 };
      l.coins.push(t); l.paidUsd += paidUsd(t); l.paidPair += t.rewards ? wei(t.rewards.holders) : 0;
      m.set(k, l);
    }
    const arr = [...m.values()];
    for (const l of arr) l.coins.sort((a, b) => Number(isPinned(b.address)) - Number(isPinned(a.address)) || Number(b.marketCapUsd) - Number(a.marketCapUsd));
    arr.sort((a, b) => Number(b.pair.isNative) - Number(a.pair.isNative) || b.paidUsd - a.paidUsd || b.coins.length - a.coins.length);
    return arr;
  }, [tokens]);
  // Open lanes: approved token pairs with an ETH route and no coin yet.
  const open = useMemo(() => {
    const used = new Set(lanes.map((l) => l.pair.address.toLowerCase()));
    return approved.filter((x) => !x.isNative && x.ethRoute && !used.has(x.address.toLowerCase())).sort((a, b) => Number(isTokenPair(b.address)) - Number(isTokenPair(a.address)) || b.liqUsd - a.liqUsd).slice(0, 6);
  }, [approved, lanes]);

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
  const flat = useMemo(() => {
    let l = (tokens ?? []).slice();
    const s = q.trim().toLowerCase();
    if (s) l = l.filter((t) => `${t.name} ${t.symbol} ${t.address} ${t.pair.symbol}`.toLowerCase().includes(s));
    l.sort((a, b) => (desc ? key(b) - key(a) : key(a) - key(b)));
    l.sort((a, b) => Number(isPinned(b.address)) - Number(isPinned(a.address)));
    return l;
  }, [tokens, q, sort, desc]);
  const head = (k: Col) => () => { if (sort === k) setDesc(!desc); else { setSort(k); setDesc(true); } };
  const showList = view === "list" || q.trim().length > 0;
  const nTokens = approved.filter((x) => !x.isNative && isTokenPair(x.address)).length;
  const nStocks = approved.filter((x) => !x.isNative && !isTokenPair(x.address)).length;

  return (
    <main>
      <section className="state">
        <div>
          <div className="eyebrow">Ethereum · Uniswap V4 · statement of payouts</div>
          <h1 style={{ marginTop: 12 }}>Launch a coin paired with <em>anything</em>. Holders get paid in it.</h1>
          <p className="claim" style={{ marginTop: 16 }}>ETH, UNI, LINK, PEPE, a tokenized stock. Every trade pays <b>{FEES.taxPct}%</b>, and <b>{FEES.holderPct}% of that goes to holders</b> in the pair asset, the moment the trade happens. No staking, no harvest.</p>
        </div>
        <div className="tally">
          <div className="n"><small>$</small>{num(totals.paid, 0)}</div>
          <div className="lbl">paid to holders so far · <i>{num(totals.n, 0)}</i> coins · <i>{num(totals.holders, 0)}</i> holders</div>
        </div>
      </section>
      <div className="ledger-line">
        <span>Fee <b>{FEES.taxPct}%</b></span><span>Holders <b>{FEES.holderPct}%</b></span><span>Creator <b>{FEES.creatorPct}%</b></span><span>Platform <b>{FEES.platformPct}%</b></span>
        <span>Pairs <b>ETH · {nTokens} tokens · {nStocks} stocks</b></span><span>Volume 24h <b>{usd(totals.vol, { compact: true })}</b></span>
        <span className="cta"><Link to="/launch" className="b vio sm">Launch a coin</Link><Link to="/docs" className="b ghost sm">Terms</Link></span>
      </div>

      {!DEPLOYED ? (
        <div className="rows" style={{ marginTop: 30 }}><div className="empty">The factory is not on Ethereum yet.</div></div>
      ) : (
        <>
          <div className="board-h">
            <h2>{showList ? "Every coin" : "The board"}<span className="eyebrow" style={{ marginLeft: 14 }}>{showList ? `${flat.length} of ${totals.n}` : `${lanes.length} lanes`}</span></h2>
            <div className="tools">
              <input className="in" placeholder="Search name, ticker or pair" value={q} onChange={(e) => setQ(e.target.value)} />
              <div className="seg"><button className={!showList ? "on" : ""} onClick={() => { setView("lanes"); setQ(""); }}>Lanes</button><button className={showList ? "on" : ""} onClick={() => setView("list")}>List</button></div>
            </div>
          </div>

          {isLoading && !tokens ? <div className="board">{[0, 1, 2].map((i) => <div key={i} className="skel" style={{ height: 320 }} />)}</div>
            : showList ? (
              <div className="rows">
                <div className="row-h">
                  <button className={sort === "new" ? "on" : ""} onClick={head("new")}>Coin {sort === "new" ? (desc ? "↓" : "↑") : ""}</button>
                  {COLS.map((c) => <button key={c.k} className={c.cls + (sort === c.k ? " on" : "")} onClick={head(c.k)}>{c.l} {sort === c.k ? (desc ? "↓" : "↑") : ""}</button>)}
                </div>
                {flat.length === 0 ? <div className="empty">Nothing matches.</div> : flat.map((t) => <Row key={t.address} t={t} />)}
              </div>
            ) : lanes.length === 0 ? (
              <div className="rows"><div className="empty">No coins yet. Open the first lane.</div></div>
            ) : (
              <div className="board">
                {lanes.map((l) => <Lane key={l.pair.address} pair={l.pair} coins={l.coins} paidUsd={l.paidUsd} paidPair={l.paidPair} />)}
                {open.map((x) => (
                  <div key={x.address} className="lane open">
                    <span className={"chip " + kindOf(false, x.address)}>{isTokenPair(x.address) ? "token" : "stock"}</span>
                    <div className="sym" style={{ marginTop: 10 }}>{x.symbol}</div>
                    <p>No coin pays out in {x.symbol} yet. {x.usd > 0 ? `${x.symbol} at ${usd(x.usd, { compact: x.usd >= 10_000 })}.` : ""}</p>
                    <Link to="/launch" className="b sm">Open the {x.symbol} lane</Link>
                  </div>
                ))}
              </div>
            )}
        </>
      )}
    </main>
  );
}

function Lane({ pair, coins, paidUsd: paid, paidPair }: { pair: Token["pair"]; coins: Token[]; paidUsd: number; paidPair: number }) {
  const kind = kindOf(pair.isNative, pair.address);
  const shown = coins.slice(0, 6);
  return (
    <div className={"lane " + kind}>
      <div className="lane-h">
        <div className="sym">{pair.symbol}<small>{kind === "eth" ? "native" : kind}</small></div>
        <div className="px">{pair.usd > 0 ? usd(pair.usd, { compact: pair.usd >= 10_000 }) : ""}</div>
        <div className="paid">paid to holders <b>{num(paidPair, 4)} {pair.symbol}</b> · {usd(paid, { compact: true })}</div>
      </div>
      <div className="lane-body">
        {shown.map((t) => {
          const c = t.priceChange24hPct;
          return (
            <Link key={t.address} to={`/t/${t.address}`} className="entry">
              <Art src={t.metadata?.logo} name={t.name} className="art" />
              <span className="nm"><b>{t.name}</b><small><span>{t.symbol}</span>{isPinned(t.address) && <span className="vi">official</span>}<span>{ago(t.createdAt)}</span></small></span>
              <span className="fig">{usd(t.marketCapUsd, { compact: true })}<small className={c == null ? "" : c >= 0 ? "up" : "down"}>{c == null ? "new" : pct(c)}</small><small className="paid">{t.rewards ? `${num(wei(t.rewards.holders), 3)} ${pair.symbol} paid` : ""}</small></span>
            </Link>
          );
        })}
      </div>
      <div className="lane-f"><span>{coins.length} coin{coins.length === 1 ? "" : "s"}{coins.length > shown.length ? ` · ${coins.length - shown.length} more in list` : ""}</span><Link to="/launch">launch here</Link></div>
    </div>
  );
}

function Row({ t }: { t: Token }) {
  const c = t.priceChange24hPct;
  return (
    <Link to={`/t/${t.address}`} className="row">
      <span className="who">
        <Art src={t.metadata?.logo} name={t.name} className="art" />
        <span style={{ minWidth: 0 }}><b>{t.name}</b><small><span>{t.symbol}</span>{isPinned(t.address) && <span className="chip official">official</span>}<span className={"chip " + kindOf(t.pair.isNative, t.pair.address)}>{t.pair.symbol}</span><span>{ago(t.createdAt)}</span></small></span>
      </span>
      <span className="n c-price">{usd(t.priceUsd)}</span>
      <span className={"n c-chg " + (c == null ? "faint" : c >= 0 ? "up" : "down")}>{c == null ? "new" : pct(c)}</span>
      <span className="n c-mcap">{usd(t.marketCapUsd, { compact: true })}<small className={c == null ? "" : c >= 0 ? "up" : "down"}>{c == null ? "new" : pct(c)}</small></span>
      <span className="n c-vol">{usd(wei(t.volume24hWei) * t.pair.usd, { compact: true })}</span>
      <span className="n c-hold">{num(t.holderCount, 0)}</span>
      <span className="n c-paid vi">{usd(paidUsd(t), { compact: true })}<small>{t.rewards ? `${num(wei(t.rewards.holders), 4)} ${t.pair.symbol}` : "—"}</small></span>
    </Link>
  );
}
