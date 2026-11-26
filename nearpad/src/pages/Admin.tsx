import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { env } from "../lib/env";
import { toUnits, units } from "../lib/format";
import { unitsFmt } from "../lib/value";
import { useCoins, useConfig, usePairs } from "../lib/hooks";
import { send, useAccount } from "../lib/wallet";

/** The platform's controls. Every call is refused on chain unless the caller is the factory owner. */
export default function Admin() {
  const { accountId } = useAccount();
  const qc = useQueryClient();
  const { data: cfg } = useConfig();
  const { data: pairs } = usePairs();
  const { data: coins } = useCoins();
  const [treasury, setTreasury] = useState("");
  const [owner, setOwner] = useState("");
  const [fee, setFee] = useState("");
  const [pair, setPair] = useState({ key: "", account: "", symbol: "", decimals: "18", name: "", reserve: "", enabled: true });
  const [coinId, setCoinId] = useState("");
  const [feeWallet, setFeeWallet] = useState("");
  const [reason, setReason] = useState("");
  const [meta, setMeta] = useState({ description: "", website: "", x: "", telegram: "" });
  const [lp, setLp] = useState({ pct: "", to: "" });
  const isOwner = !!accountId && cfg?.owner === accountId;
  const call = (label: string, methodName: string, args: Record<string, unknown>, deposit?: string) => send(label, [{ receiverId: env.factory, methodName, args, deposit, gas: "100000000000000" }], () => qc.invalidateQueries());
  const owed = (coins ?? []).filter((c) => c.info.platform_credit !== "0");
  const owedNear = owed.filter((c) => c.info.pair === "Near").reduce((s, c) => s + units(c.info.platform_credit, 24), 0);
  const collectAll = () => {
    const ids = owed.slice(0, 10).map((c) => c.id);
    if (ids.length === 0) return;
    return send(`Collect fees from ${ids.length} coins`, [{ receiverId: env.factory, methodName: "collect_platform_many", args: { ids }, gas: "300000000000000" }], () => qc.invalidateQueries());
  };
  if (!cfg) return <main><div className="skel" style={{ height: 200 }} /></main>;
  if (!isOwner) return <main className="gate"><h1>Admin</h1><p>Only the factory owner, {cfg.owner}, can use this page.</p></main>;
  const idNum = Number(coinId);
  return (
    <main>
      <div className="sec" style={{ marginTop: 4 }}><h2>Admin</h2><span className="eyebrow">{env.factory}</span></div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-h"><h2>Platform fees</h2><span className="eyebrow">paid to the treasury on every trade</span></div>
        <div className="card-b creditbox">
          <div className="bigv">{(coins ?? []).filter((c) => c.info.pair === "Near").reduce((s, c) => s + units(c.info.platform_fees_total, 24), 0).toFixed(4)}<small>NEAR lifetime</small></div>
          <div className="faint" style={{ fontSize: 13 }}>The platform's 20% of every tax lands in the treasury, {cfg.treasury}, as each trade settles. Nothing to collect on NEAR coins.</div>
          {owed.length > 0 && <>
            <div className="warn">{owedNear > 0 ? `${owedNear.toFixed(4)} NEAR and ` : ""}fees in other pairs could not be delivered (the treasury may not be registered on that token). Register it, then collect.</div>
            <div className="row-flex"><button className="b pri" onClick={collectAll}>Collect from {Math.min(owed.length, 10)} coin{owed.length === 1 ? "" : "s"}</button></div>
            <div className="faint" style={{ fontSize: 13 }}>{owed.map((c) => `${c.symbol} ${units(c.info.platform_credit, c.info.pair === "Near" ? 24 : c.info.pair.Token.decimals).toFixed(4)} ${c.info.pair === "Near" ? "NEAR" : c.info.pair.Token.symbol}`).join(" · ")}</div>
          </>}
        </div>
      </div>
      <div className="admin">
        <div className="card">
          <div className="card-h"><h2>Platform</h2><span className="eyebrow">{cfg.paused ? "launches paused" : "launches open"}</span></div>
          <div className="card-b">
            <dl className="kv"><dt>Owner</dt><dd style={{ wordBreak: "break-all" }}>{cfg.owner}</dd><dt>Treasury</dt><dd style={{ wordBreak: "break-all" }}>{cfg.treasury}</dd><dt>Launch fee</dt><dd>{units(cfg.launch_fee, 24)} NEAR</dd><dt>Coin code</dt><dd>{cfg.current_version?.version ?? "none"}</dd><dt>Coins</dt><dd>{cfg.count}</dd></dl>
            <div className="row-flex"><button className={"b sm " + (cfg.paused ? "pri" : "")} onClick={() => call(cfg.paused ? "Resume launches" : "Pause launches", "set_paused", { paused: !cfg.paused })}>{cfg.paused ? "Resume launches" : "Pause launches"}</button></div>
            <div className="f"><label>Treasury</label><div className="row-flex"><input className="in" value={treasury} onChange={(e) => setTreasury(e.target.value)} placeholder="treasury.near" /><button className="b sm" disabled={!treasury} onClick={() => call("Set treasury", "set_treasury", { treasury })}>Set</button></div></div>
            <div className="f"><label>Launch fee, NEAR</label><div className="row-flex"><input className="in" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="0.5" /><button className="b sm" disabled={!fee} onClick={() => call("Set launch fee", "set_launch_fee", { launch_fee: toUnits(fee, 24).toString() })}>Set</button></div></div>
            <div className="f"><label>Transfer ownership</label><div className="row-flex"><input className="in" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="multisig.near" /><button className="b sm sell" disabled={!owner} onClick={() => { if (confirm(`Hand the factory to ${owner}? This cannot be undone from here.`)) call("Set owner", "set_owner", { owner }); }}>Transfer</button></div></div>
          </div>
        </div>

        <div className="card">
          <div className="card-h"><h2>Pairs</h2><span className="eyebrow">{pairs?.length ?? 0} listed</span></div>
          <div className="card-b">
            {(pairs ?? []).map((p) => (
              <div key={p.key} className="row-flex" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <span><b>{p.key}</b> <span className="faint">{p.name} · graduates at {units(p.virtual_reserve, p.asset === "Near" ? 24 : p.asset.Token.decimals) * 2} {p.key}</span></span>
                <button className="b ghost sm" onClick={() => call(p.enabled ? `Switch off ${p.key}` : `Switch on ${p.key}`, "set_pair", { key: p.key, asset: p.asset, name: p.name, virtual_reserve: p.virtual_reserve, enabled: !p.enabled })}>{p.enabled ? "Switch off" : "Switch on"}</button>
              </div>
            ))}
            <div className="f2">
              <div className="f"><label>Key</label><input className="in" value={pair.key} onChange={(e) => setPair({ ...pair, key: e.target.value })} placeholder="NVDAon" /></div>
              <div className="f"><label>Name</label><input className="in" value={pair.name} onChange={(e) => setPair({ ...pair, name: e.target.value })} placeholder="NVIDIA (Ondo)" /></div>
            </div>
            <div className="f"><label>Token account</label><input className="in" value={pair.account} onChange={(e) => setPair({ ...pair, account: e.target.value })} placeholder="bnb-0x….omdep.near" /></div>
            <div className="f2">
              <div className="f"><label>Symbol</label><input className="in" value={pair.symbol} onChange={(e) => setPair({ ...pair, symbol: e.target.value })} placeholder="NVDAon" /></div>
              <div className="f"><label>Decimals</label><input className="in" value={pair.decimals} onChange={(e) => setPair({ ...pair, decimals: e.target.value })} /></div>
            </div>
            <div className="f"><label>Virtual reserve, in the pair (graduates at twice this)</label><input className="in" value={pair.reserve} onChange={(e) => setPair({ ...pair, reserve: e.target.value })} placeholder="41.1" /></div>
            <div className="row-flex"><button className="b pri sm" disabled={!pair.key || !pair.account || !pair.symbol || !pair.reserve} onClick={() => call(`Add pair ${pair.key}`, "set_pair", { key: pair.key, asset: { Token: { account_id: pair.account, symbol: pair.symbol, decimals: Number(pair.decimals) } }, name: pair.name || pair.key, virtual_reserve: toUnits(pair.reserve, Number(pair.decimals)).toString(), enabled: pair.enabled })}>Add or update pair</button></div>
          </div>
        </div>

        <div className="card">
          <div className="card-h"><h2>A coin</h2><span className="eyebrow">by id</span></div>
          <div className="card-b">
            <div className="f"><label>Coin</label><select className="in" value={coinId} onChange={(e) => setCoinId(e.target.value)}><option value="">Pick a coin</option>{(coins ?? []).map((c) => <option key={c.id} value={c.id}>#{c.id} {c.symbol} · {c.name}{c.hidden ? " (hidden)" : ""}</option>)}</select></div>
            {idNum > 0 && (
              <>
                <div className="row-flex">
                  <button className="b ghost sm" onClick={() => { const c = coins?.find((x) => x.id === idNum); call(c?.hidden ? "Show coin" : "Hide coin", "set_hidden", { id: idNum, hidden: !c?.hidden }); }}>{coins?.find((x) => x.id === idNum)?.hidden ? "Show in list" : "Hide from list"}</button>
                </div>
                <div className="f"><label>Re-point creator fees (takeover)</label><input className="in" value={feeWallet} onChange={(e) => setFeeWallet(e.target.value)} placeholder="community-lead.near" /><input className="in" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason, published on chain" style={{ marginTop: 6 }} /><div className="row-flex" style={{ marginTop: 6 }}><button className="b sell sm" disabled={!feeWallet} onClick={() => { if (confirm(`Send future creator fees of coin #${idNum} to ${feeWallet}?`)) call("Takeover", "coin_set_fee_wallet", { id: idNum, fee_wallet: feeWallet, reason: reason || null }); }}>Re-point fees</button></div></div>
                {coins?.find((x) => x.id === idNum)?.info.phase === "Curve" && (
                  <div className="f"><label>Withdraw from the curve</label><div className="f2"><input className="in" value={lp.pct} onChange={(e) => setLp({ ...lp, pct: e.target.value })} placeholder="% of the curve, 1 to 100" /><input className="in" value={lp.to} onChange={(e) => setLp({ ...lp, to: e.target.value })} placeholder={cfg.treasury} /></div><div className="help">Pulls that share of what the curve holds, the {coins!.find((x) => x.id === idNum)!.pair} raised so far and the unsold tokens, to the wallet. The curve carries on with what is left, so the price falls. Not reversible.</div><div className="row-flex" style={{ marginTop: 6 }}><button className="b sell sm" disabled={!(Number(lp.pct) > 0 && Number(lp.pct) <= 100)} onClick={() => { const to = lp.to.trim() || cfg.treasury; if (confirm(`Pull ${lp.pct}% of coin #${idNum}'s curve to ${to}?`)) call("Withdraw from the curve", "coin_collect_curve", { id: idNum, bps: Math.round(Number(lp.pct) * 100), to }); }}>Withdraw</button></div></div>
                )}
                {coins?.find((x) => x.id === idNum)?.info.phase === "Pool" && (
                  <>
                    <div className="f"><label>Withdraw liquidity</label><div className="f2"><input className="in" value={lp.pct} onChange={(e) => setLp({ ...lp, pct: e.target.value })} placeholder="% of the LP, 1 to 100" /><input className="in" value={lp.to} onChange={(e) => setLp({ ...lp, to: e.target.value })} placeholder={cfg.treasury} /></div><div className="help">Moves that share of the coin's Rhea LP shares to the wallet, which can then remove the liquidity on Rhea under Your liquidity. Attaches 0.01 NEAR for the wallet's registration on the pool. Not reversible.</div><div className="row-flex" style={{ marginTop: 6 }}><button className="b sell sm" disabled={!(Number(lp.pct) > 0 && Number(lp.pct) <= 100)} onClick={() => { const to = lp.to.trim() || cfg.treasury; if (confirm(`Move ${lp.pct}% of coin #${idNum}'s LP to ${to}?`)) send("Withdraw liquidity", [{ receiverId: env.factory, methodName: "coin_collect_liquidity", args: { id: idNum, bps: Math.round(Number(lp.pct) * 100), to }, deposit: "10000000000000000000000", gas: "150000000000000" }], () => qc.invalidateQueries()); }}>Withdraw</button></div></div>
                    <div className="f"><label>Harvest the tax</label><div className="help">{unitsFmt(units(coins!.find((x) => x.id === idNum)!.info.tax_tokens, 18))} {coins!.find((x) => x.id === idNum)!.symbol} of tax waiting. Anyone can harvest once 1,000 tokens have gathered; it burns, sells the rest on Rhea and pays everyone out, the platform included.</div><div className="row-flex" style={{ marginTop: 6 }}><button className="b sm" onClick={() => { const c = coins!.find((x) => x.id === idNum)!; send(`Harvest ${c.symbol}`, [{ receiverId: c.account_id, methodName: "harvest", gas: "300000000000000" }], () => qc.invalidateQueries()); }}>Harvest</button></div></div>
                  </>
                )}
                <div className="f"><label>Fix description or links</label><textarea className="in" value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} placeholder="New description (leave empty to keep)" maxLength={280} /><input className="in" value={meta.website} onChange={(e) => setMeta({ ...meta, website: e.target.value })} placeholder="https://website" style={{ marginTop: 6 }} /><input className="in" value={meta.x} onChange={(e) => setMeta({ ...meta, x: e.target.value })} placeholder="https://x.com/handle" style={{ marginTop: 6 }} /><input className="in" value={meta.telegram} onChange={(e) => setMeta({ ...meta, telegram: e.target.value })} placeholder="https://t.me/group" style={{ marginTop: 6 }} /><div className="row-flex" style={{ marginTop: 6 }}><button className="b sm" onClick={() => call("Set metadata", "coin_set_metadata", { id: idNum, icon: null, description: meta.description || null, links: meta.website || meta.x || meta.telegram ? { website: meta.website || null, x: meta.x || null, telegram: meta.telegram || null } : null })}>Save</button></div></div>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
