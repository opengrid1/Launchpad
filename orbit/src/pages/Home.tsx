import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { Art } from "../components/Art";
import { FEES } from "../lib/env";
import { ago, hype, num, pct, usd, wei } from "../lib/format";
import { useHypeUsd, useTokens, type Token } from "../lib/hooks";
import { countdown, secondsLeft } from "../lib/onair";

type Sort = "new" | "auctions" | "top" | "movers";

const inAuction = (t: Token) => !!t.auction && !t.auction.finalized;

export default function Home() {
  const { data: tokens, isLoading } = useTokens();
  const { data: hypeUsd = 0 } = useHypeUsd();
  const [sp] = useSearchParams();
  const [sort, setSort] = useState<Sort>((["new", "auctions", "top", "movers"].includes(sp.get("sort") ?? "") ? sp.get("sort") : "new") as Sort);
  const [q, setQ] = useState("");

  const list = useMemo(() => {
    let l = (tokens ?? []).slice();
    const s = q.trim().toLowerCase();
    if (s) l = l.filter((t) => `${t.name} ${t.symbol} ${t.address}`.toLowerCase().includes(s));
    if (sort === "auctions") l = l.filter(inAuction).sort((a, b) => (a.auction!.open === b.auction!.open ? a.auction!.endBlock - b.auction!.endBlock : a.auction!.open ? -1 : 1));
    else if (sort === "top") l.sort((a, b) => Number(b.marketCapUsd) - Number(a.marketCapUsd));
    else if (sort === "movers") l.sort((a, b) => (b.priceChange24hPct ?? -1e9) - (a.priceChange24hPct ?? -1e9));
    else l.sort((a, b) => b.createdAt - a.createdAt);
    return l;
  }, [tokens, sort, q]);

  const auctions = useMemo(() => (tokens ?? []).filter((t) => inAuction(t) && t.auction!.open).sort((a, b) => a.auction!.endBlock - b.auction!.endBlock), [tokens]);
  const onair = useMemo(() => (tokens ?? []).filter((t) => !inAuction(t)).slice().sort((a, b) => wei(b.volume24hWei) - wei(a.volume24hWei) || b.createdAt - a.createdAt).slice(0, 4), [tokens]);

  return (
    <main className="page">
      <section className="hero">
        <div>
          <div className="lbl row" style={{ gap: 10, marginBottom: 14 }}><span className="dot" />Broadcasting from HyperEVM</div>
          <h1>Go <em>live</em><br />with a coin.</h1>
          <p className="sub">Launch instantly, or run a four-hour auction where every bidder pays one price. Every trade is broadcast here, and every trade pays the creator.</p>
          <div className="cta"><Link to="/launch" className="btn red">Go live</Link><a href="#feed" className="btn ghost">Watch the feed</a></div>
        </div>
        <div className="m-only">
          <div className="sec-h" style={{ marginBottom: 8 }}><h2>On air now</h2><span className="lbl">{auctions.length ? "auctions · most traded" : "most traded"}</span></div>
          <div className="strip">{[...auctions.slice(0, 3), ...onair].map((t) => (
            <Link key={t.address} to={`/t/${t.address}`} className="sc">
              <Art src={t.metadata?.logo} name={t.name} className="av" />
              <b>{t.name}</b>
              {inAuction(t) ? <small className="amber">AUCTION · {countdown(secondsLeft(t.auction!))}</small> : <small>{usd(t.marketCapUsd, { compact: true })} · <span className={(t.priceChange24hPct ?? 0) >= 0 ? "up" : "down"}>{pct(t.priceChange24hPct)}</span></small>}
            </Link>
          ))}</div>
        </div>
        <div className="board d-only">
          <div className="lbl"><span className="dot" />On air now</div>
          {isLoading ? <div className="empty">Tuning in…</div> : auctions.length + onair.length === 0 ? <div className="empty">Nothing on air yet. Be the first.</div> : [...auctions.slice(0, 2), ...onair].slice(0, 4).map((t) => (
            <Link key={t.address} to={`/t/${t.address}`} className="rowi">
              <Art src={t.metadata?.logo} name={t.name} className="av" />
              <div className="nm">{t.name}<small>{t.symbol} · {inAuction(t) ? `auction · ${hype(wei(t.auction!.raised), 1)} / ${hype(wei(t.auction!.minRaiseWei), 0)} HYPE` : `${ago(t.createdAt)} · ${num(t.holderCount || 0, 0)} holders`}</small></div>
              <div className="px">{inAuction(t) ? <><b className="amber">{countdown(secondsLeft(t.auction!))}</b><span className="faint">{usd(t.marketCapUsd, { compact: true })} FDV</span></> : <><b>{usd(t.priceUsd)}</b><span className={(t.priceChange24hPct ?? 0) >= 0 ? "up" : "down"}>{pct(t.priceChange24hPct)}</span></>}</div>
            </Link>
          ))}
        </div>
      </section>

      <section className="sec" id="feed">
        <div className="sec-h">
          <h2>Feed</h2>
          <div className="toolbar">
            <div className="seg">{(["new", "auctions", "top", "movers"] as Sort[]).map((s) => <button key={s} className={sort === s ? "on" : ""} onClick={() => setSort(s)}>{s === "new" ? "Newest" : s === "auctions" ? "Auctions" : s === "top" ? "Biggest" : "Movers"}</button>)}</div>
            <label className="search m-search"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg><input placeholder="Search coins" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          </div>
        </div>
        <div className="grid d-only">
          {isLoading ? Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton" />) : (
            <>
              {list.map((t) => <Card key={t.address} t={t} hypeUsd={hypeUsd} />)}
              <Link to="/launch" className="card new"><div><div className="plus">+</div>Your coin here<br /><small>free · instant or auction</small></div></Link>
            </>
          )}
        </div>
        <div className="list m-only">
          {isLoading ? <div className="skeleton" style={{ minHeight: 200, border: 0, borderRadius: 0 }} /> : list.map((t) => {
            const chg = t.priceChange24hPct; const fresh = Date.now() / 1000 - t.createdAt < 3600;
            const auc = inAuction(t);
            return (
              <Link key={t.address} to={`/t/${t.address}`} className="li">
                <Art src={t.metadata?.logo} name={t.name} className="art" size={48} />
                <div className="nm">{t.name} {auc ? <span className="lv amber">● AUCTION</span> : fresh && <span className="lv">● LIVE</span>}<small>{t.symbol} · {auc ? `${countdown(secondsLeft(t.auction!))} left · ${hype(wei(t.auction!.raised), 1)} HYPE in` : `${ago(t.createdAt)} · ${num(t.holderCount || 0, 0)} holders`}</small></div>
                <div className="px mono"><b>{usd(t.marketCapUsd, { compact: true })}</b>{auc ? <span className="faint">clearing</span> : <span className={chg == null ? "faint" : chg >= 0 ? "up" : "down"}>{pct(chg)}</span>}</div>
              </Link>
            );
          })}
          {!isLoading && <Link to="/launch" className="li add"><span className="plus">+</span><div className="nm">Your coin here<small>free · instant or auction</small></div><span /></Link>}
        </div>
        {!isLoading && list.length === 0 && q && <p className="small" style={{ marginTop: 12 }}>No coins match "{q}".</p>}
        {!isLoading && list.length === 0 && !q && sort === "auctions" && <p className="small" style={{ marginTop: 12 }}>No auction running right now. <Link to="/launch" style={{ color: "var(--green)" }}>Open one</Link>.</p>}
      </section>

      <div className="rules">
        <div><b>$0</b><span>to launch. Gas only. Instant, or a 4-hour auction.</span></div>
        <div><b className="r">{FEES.poolPct}%</b><span>fee on every trade. The only fee.</span></div>
        <div><b>{FEES.creatorPct}%</b><span>of it paid to the creator. {FEES.platformPct}% runs the station.</span></div>
        <div><b>∞</b><span>liquidity locked in the factory. No rug possible.</span></div>
      </div>
    </main>
  );
}

function Card({ t, hypeUsd }: { t: Token; hypeUsd: number }) {
  const chg = t.priceChange24hPct;
  const fresh = Date.now() / 1000 - t.createdAt < 3600;
  const a = t.auction;
  if (a && !a.finalized) {
    const raisedPct = a.minRaiseWei > 0n ? Math.min(100, (Number(a.raised) / Number(a.minRaiseWei)) * 100) : 0;
    return (
      <Link to={`/t/${t.address}`} className="card auc">
        <span className="live amber"><i />{a.open ? countdown(secondsLeft(a)) : a.cancelled ? "CANCELLED" : "ENDED"}</span>
        <Art src={t.metadata?.logo} name={t.name} className="art" />
        <span className="tag amber">AUCTION</span>
        <h3>{t.name}</h3>
        <p>{t.symbol} · {num(a.bidCount, 0)} bids · {hype(wei(a.raised), 1)} HYPE in</p>
        <div className="bar" style={{ marginBottom: 8 }}><i style={{ width: `${raisedPct}%` }} /></div>
        <div className="st"><b>{usd(t.marketCapUsd, { compact: true })} clearing</b><span className="faint">{raisedPct.toFixed(0)}% bonded</span></div>
      </Link>
    );
  }
  return (
    <Link to={`/t/${t.address}`} className="card">
      <span className="live"><i />LIVE</span>
      <Art src={t.metadata?.logo} name={t.name} className="art" />
      {fresh && <span className="tag">NEW</span>}
      <h3>{t.name}</h3>
      <p>{t.symbol} · {ago(t.createdAt)} · {usd(wei(t.volume24hWei) * hypeUsd, { compact: true })} today</p>
      <div className="st"><b>{usd(t.marketCapUsd, { compact: true })} cap</b><span className={chg == null ? "faint" : chg >= 0 ? "up" : "down"}>{pct(chg)}</span></div>
    </Link>
  );
}
