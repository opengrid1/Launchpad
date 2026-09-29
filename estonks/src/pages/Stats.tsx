import { useMemo } from "react";
import { Link } from "react-router-dom";

import { Art } from "../components/Art";
import { FEES, isMain } from "../lib/env";
import { num, usd, wei } from "../lib/format";
import { useQuotes, useTokens } from "../lib/hooks";

/** Platform stats, read from the chain: paid to holders, creators and the platform, volume, launches. */
export default function Stats() {
  const { data: tokens } = useTokens();
  const { data: quotes } = useQuotes();
  const s = useMemo(() => {
    const list = (tokens ?? []).filter((t) => !t.hidden);
    const u = (v: bigint, p: number) => wei(v) * p;
    const holders = list.reduce((a, t) => a + u(t.fees?.holder ?? 0n, t.pair.usd), 0);
    const creators = list.reduce((a, t) => a + u(t.fees?.creator ?? 0n, t.pair.usd), 0);
    const platform = list.reduce((a, t) => a + u(t.fees?.platform ?? 0n, t.pair.usd), 0);
    const vol24 = list.reduce((a, t) => a + u(BigInt(t.volume24hWei), t.pair.usd), 0);
    const volAll = list.reduce((a, t) => a + u(BigInt(t.volumeTotalWei), t.pair.usd), 0);
    const trades24 = list.reduce((a, t) => a + t.txCount24h, 0);
    const dayAgo = Math.floor(Date.now() / 1000) - 86400;
    const launched24 = list.filter((t) => t.createdAt >= dayAgo).length;
    const top = [...list].sort((a, b) => u(BigInt(b.volume24hWei), b.pair.usd) - u(BigInt(a.volume24hWei), a.pair.usd)).slice(0, 5);
    return { n: list.length, holders, creators, platform, vol24, volAll, trades24, launched24, top };
  }, [tokens]);
  const stocks = quotes ? quotes.filter((q) => q.approved && !q.isNative).length : 0;

  return (
    <main>
      <div style={{ paddingTop: 14 }}><h1>Stats.</h1><p className="lede">Live from Ethereum.</p></div>
      <section className="hero" style={{ marginTop: 14 }}>
        <div className="head"><div><span className="label">Paid to STONK holders</span><div className="big">{usd(s.platform)}</div><div className="sub">{(FEES.taxPct * FEES.platformPct / 100).toFixed(1)}% of every trade on every coin</div></div></div>
      </section>
      <div className="figs" style={{ marginTop: 12 }}>
        <div><span className="label">Volume</span><b>{usd(s.volAll, { compact: true })}</b><small>{usd(s.vol24, { compact: true })} 24h</small></div>
        <div><span className="label">Paid to creators</span><b>{usd(s.creators, { compact: s.creators >= 1e5 })}</b><small>{s.n} coins</small></div>
        <div><span className="label">Paid to coin holders</span><b>{usd(s.holders, { compact: s.holders >= 1e5 })}</b><small>in the pair asset</small></div>
        <div><span className="label">Launches · trades 24h</span><b>{s.n} · {num(s.trades24, 0)}</b><small>{s.launched24} launched today · {stocks} stocks listed</small></div>
      </div>

      <div className="sec"><h2>Top volume, 24h</h2></div>
      {!tokens ? <div className="skel" style={{ height: 120 }} /> : s.top.length === 0 ? <div className="empty">No trades yet.</div> : (
        <div className="card">{s.top.map((t, i) => <Link key={t.address} className="rank" to={`/t/${t.address}`}><i>{String(i + 1).padStart(2, "0")}</i><b style={{ display: "flex", alignItems: "center", gap: 8 }}><Art src={t.metadata?.logo} address={t.address} size="sm" />{t.symbol}{isMain(t.address) && <span className="badge main">MAIN</span>}</b><span className="amt">{usd(wei(t.volume24hWei) * t.pair.usd, { compact: true })}</span></Link>)}</div>
      )}

      <div className="sec"><h2>Fees</h2></div>
      <div className="card">
        <h3>Fee split</h3>
        <div className="split"><i className="c" style={{ width: `${FEES.creatorPct}%` }} /><i className="h" style={{ width: `${FEES.holderPct}%` }} /><i className="m" style={{ width: `${FEES.platformPct}%` }} /></div>
        <div className="kv"><span>Trade fee</span><b>{FEES.taxPct}%</b></div>
        <div className="kv"><span><i className="sw" style={{ background: "#ffab7a" }} />Creator</span><b>{(FEES.taxPct * FEES.creatorPct / 100).toFixed(1)}%</b></div>
        <div className="kv"><span><i className="sw" style={{ background: "#9b7dff" }} />Coin holders</span><b>{(FEES.taxPct * FEES.holderPct / 100).toFixed(1)}%</b></div>
        <div className="kv"><span><i className="sw" style={{ background: "#e3b657" }} />STONK holders</span><b>{(FEES.taxPct * FEES.platformPct / 100).toFixed(1)}%</b></div>
      </div>
    </main>
  );
}
