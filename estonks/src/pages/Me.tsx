import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";

import { Art } from "../components/Art";
import { client } from "../lib/client";
import { isMain } from "../lib/env";
import { hype, num, pct, short, usd, wei } from "../lib/format";
import { runTx, usePortfolio } from "../lib/hooks";
import { ensureWallet, openWalletModal } from "../lib/wallet";

/** Portfolio: rewards ready to claim, positions, and the coins this wallet launched. */
export default function Me() {
  const { address: me, isConnected } = useAccount();
  const qc = useQueryClient();
  const { data } = usePortfolio(me);
  if (!isConnected || !me) return <main className="gate"><h1>Portfolio.</h1><p className="lede">Connect a wallet to see your coins and the rewards waiting for you.</p><button className="btn pri" onClick={() => openWalletModal()}>Connect wallet</button></main>;

  const refresh = () => { qc.invalidateQueries({ queryKey: ["portfolio"] }); qc.invalidateQueries({ queryKey: ["ledger"] }); qc.invalidateQueries({ queryKey: ["bal"] }); };
  const act = (label: string, fn: () => Promise<`0x${string}`>) => async () => { await ensureWallet(); const ok = await runTx(label, fn); if (ok) refresh(); };
  const held = data?.held ?? [];
  const value = held.reduce((s, h) => s + wei(h.bal) * Number(h.t.priceUsd), 0);
  const rewards = held.filter((h) => h.pending > 0n);
  const rewardUsd = rewards.reduce((s, h) => s + wei(h.pending) * h.t.pair.usd, 0);
  const created = data?.created ?? [];
  const creatorUsd = created.reduce((s, t) => { const r = data?.ledgers.get(t.address.toLowerCase()); return s + (r ? wei(r.creatorFees) * t.pair.usd : 0); }, 0);
  const lifetimeUsd = held.reduce((s, h) => 0 + s, 0);

  return (
    <main>
      <div style={{ paddingTop: 14 }}><h1>Portfolio.</h1><p className="lede num">{me}</p></div>
      <div className="figs" style={{ marginTop: 14 }}>
        <div><span className="label">Holdings</span><b>{usd(value, { compact: value >= 1e5 })}</b><small>{held.filter((h) => h.bal > 0n).length} {held.filter((h) => h.bal > 0n).length === 1 ? "coin" : "coins"}</small></div>
        <div><span className="label">Rewards</span><b>{usd(rewardUsd)}</b><small>{rewards.length} {rewards.length === 1 ? "coin" : "coins"} paying</small></div>
        <div><span className="label">Creator fees</span><b>{usd(creatorUsd)}</b><small>{created.length} launched</small></div>
        <div><span className="label">STONK share</span><b>{(() => { const m = held.find((h) => isMain(h.t.address)); return m && m.t.totalSupply ? `${((Number(m.bal) / Number(BigInt(m.t.totalSupply))) * 100).toFixed(3)}%` : "0%"; })()}</b><small>of supply{lifetimeUsd ? "" : ""}</small></div>
      </div>

      <section className="hero">
        <div className="head"><div><span className="label">Ready to claim</span><div className="big">{usd(rewardUsd)}</div><div className="sub">{rewards.length === 0 ? "Rewards show up here as your coins trade." : `From ${rewards.length} ${rewards.length === 1 ? "coin" : "coins"}`}</div></div>
          <button className="btn pri sm" style={{ height: 40 }} disabled={rewards.length === 0} onClick={act("Claim all", () => client.claimMany(rewards.map((h) => h.t.address)))}>Claim all</button></div>
        {rewards.length > 0 && <div className="lines">{rewards.map((h) => <div key={h.t.address} className="line"><span><i className="dot" style={{ background: isMain(h.t.address) ? "#e3b657" : h.t.pair.isNative ? "#a9b8cc" : "#9b7dff" }} />{h.t.symbol}</span><b>{hype(wei(h.pending), 5)} {h.t.pair.symbol}</b></div>)}</div>}
      </section>

      <div className="sec"><h2>Positions</h2><span className="badge mute">{held.filter((h) => h.bal > 0n).length} coins</span></div>
      {!data ? <div className="skel" style={{ height: 120 }} /> : held.filter((h) => h.bal > 0n).length === 0 ? <div className="empty">Nothing held yet. <Link to="/">Browse coins</Link></div> : (
        <div className="list">{held.filter((h) => h.bal > 0n).map(({ t, bal, pending }) => { const c = t.priceChange24hPct; return (
          <Link key={t.address} className="item" to={`/t/${t.address}`}>
            <Art src={t.metadata?.logo} address={t.address} size="sm" />
            <span><b>{t.symbol}{isMain(t.address) && <span className="badge main" style={{ marginLeft: 6 }}>MAIN</span>}</b><small className="num">{num(wei(bal))} · {pending > 0n ? `${hype(wei(pending), 5)} ${t.pair.symbol} to claim` : `${t.pair.symbol} pair`}</small></span>
            <span className="amt">{usd(wei(bal) * Number(t.priceUsd))}<br /><small className={c == null ? "" : c >= 0 ? "up" : "down"}>{c == null ? "new" : pct(c)}</small></span>
          </Link>); })}</div>
      )}

      <div className="sec"><h2>Launched by you</h2><span className="badge mute">{created.length}</span></div>
      {!data ? <div className="skel" style={{ height: 120 }} /> : created.length === 0 ? <div className="empty">Nothing yet. <Link to="/launch">Launch a coin</Link></div> : (
        <div className="list">{created.map((t) => { const r = data.ledgers.get(t.address.toLowerCase()); const fees = r?.creatorFees ?? 0n; return (
          <div key={t.address} className="item">
            <Art src={t.metadata?.logo} address={t.address} size="sm" />
            <span><Link to={`/t/${t.address}`}><b>{t.symbol}</b></Link><small className="num">{usd(t.marketCapUsd, { compact: true })} mcap · {hype(wei(fees), 5)} {t.pair.symbol} to claim</small></span>
            <span className="rowb"><button className="btn dim claim sm" disabled={fees === 0n} onClick={act("Claim creator fees", () => client.payCreator(t.address))}>Claim {t.pair.symbol}</button></span>
          </div>); })}</div>
      )}
      <p className="note">{short(me)} · rewards are credited as each trade happens, in the coin's pair asset.</p>
    </main>
  );
}
