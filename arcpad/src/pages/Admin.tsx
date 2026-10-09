import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Address } from "viem";
import { useAccount } from "wagmi";

import { Art } from "../components/Art";
import { Copy } from "../components/Copy";
import { client, type QuoteView } from "../lib/client";
import { ADDRESSES, env, FEES, isHidden } from "../lib/env";
import { hype, num, short, usd, wei } from "../lib/format";
import { runTx, useConfig, useIsAdmin, useTokens, type Token } from "../lib/hooks";
import { ensureWallet, openWalletModal } from "../lib/wallet";

type Fn = Parameters<typeof client.adminCall>[0];
const ZERO = "0x0000000000000000000000000000000000000000" as Address;

export default function Admin() {
  const { address: me, isConnected } = useAccount();
  const admin = useIsAdmin();
  const { data: cfg } = useConfig();
  const { data: tokens } = useTokens();
  const qc = useQueryClient();
  const [f, setF] = useState({ feeTo: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const call = (label: string, fn: Fn, args: unknown[] = []) => async () => {
    if (!isConnected) return openWalletModal();
    await ensureWallet();
    await runTx(label, () => client.adminCall(fn, args), async () => { await qc.invalidateQueries(); });
  };
  if (!isConnected) return <main className="page"><section className="hero"><h1>Platform <em>admin</em>.</h1><p className="sub">Connect the admin wallet.</p><div className="cta"><button className="btn acc" onClick={() => openWalletModal()}>Connect wallet</button></div></section></main>;

  return (
    <main className="page">
      <div className="sec-h"><h2>Admin · {short(me!)}</h2><span className={"tag " + (admin ? "up" : "")}>{admin ? "admin" : "read only"}</span></div>
      {!admin && <div className="warn">This wallet is not the factory admin. Actions will revert. Admin: {cfg ? short(cfg.admin) : "…"}</div>}
      <section className="sec">
        <div className="panel"><dl className="kv">
          <dt>Factory</dt><dd><Copy value={ADDRESSES.factory} full /></dd>
          <dt>Router</dt><dd><Copy value={ADDRESSES.router} full /></dd>
          <dt>Admin</dt><dd>{cfg ? <Copy value={cfg.admin} full /> : "…"}</dd>
          <dt>Owner</dt><dd>{cfg ? (cfg.owner === ZERO ? "renounced" : <Copy value={cfg.owner} full />) : "…"}</dd>
          <dt>Fee recipient</dt><dd>{cfg ? <Copy value={cfg.feeRecipient} full /> : "…"}</dd>
          <dt>Launches</dt><dd>{cfg ? (cfg.paused ? <span className="down">Paused</span> : <span className="up">Open</span>) : "…"}</dd>
          <dt>Fee</dt><dd>{cfg ? `${cfg.taxBps / 100}% pool fee · ${cfg.creatorBps / 100}% creator / ${(10000 - cfg.creatorBps) / 100}% platform` : "…"}</dd>
          <dt>Coins</dt><dd>{cfg ? num(cfg.totalTokens, 0) : "…"}</dd>
        </dl></div>
      </section>
      <section className="sec">
        <div className="steps two">
          <div className="step">
            <div className="step-h"><h3>Launches</h3></div>
            {cfg?.paused ? <button className="btn acc" onClick={call("Resume launches", "resume")}>Resume launches</button> : <button className="btn" onClick={call("Pause launches", "pause")}>Pause launches</button>}
            <p className="note">Pausing blocks new launches only. Trading and fee collection keep running.</p>
          </div>
          <div className="step">
            <div className="step-h"><h3>Fee recipient</h3></div>
            <div className="row"><input className="inp" placeholder={cfg?.feeRecipient ?? "0x…"} value={f.feeTo} onChange={set("feeTo")} /><button className="btn" disabled={!/^0x[0-9a-fA-F]{40}$/.test(f.feeTo)} onClick={call("Set fee recipient", "setFeeRecipient", [f.feeTo as Address])}>Set</button></div>
            <p className="note">Where every coin's platform share goes when anyone pushes it.</p>
          </div>
        </div>
      </section>
      <section className="sec">
        <Fees tokens={tokens} call={call} />
      </section>
      <p className="note"><Link to="/" className="acc">Back to coins</Link></p>
    </main>
  );
}

/** Every coin: platform fees waiting (collect per coin or all at once) and
 *  admin-only liquidity recovery, like the Robinhood launchpad admin. */
function Fees({ tokens, call }: { tokens?: Token[]; call: (label: string, fn: Fn, args?: unknown[]) => () => Promise<void> }) {
  const qc = useQueryClient();
  const { address: me } = useAccount();
  const [lookup, setLookup] = useState("");
  const [recover, setRecover] = useState<{ t: Token; pct: string; to: string } | null>(null);
  const [recoverAll, setRecoverAll] = useState<{ pct: string; to: string; busy: boolean; done: number; total: number } | null>(null);
  const { data: waiting } = useQuery({
    queryKey: ["platformWaiting", tokens?.map((t) => t.address).join(",")],
    enabled: !!tokens,
    refetchInterval: 30_000,
    queryFn: () => client.platformWaiting((tokens ?? []).map((t) => t.address)),
  });
  const pending = (t: Token) => waiting?.get(t.address.toLowerCase()) ?? 0n;
  const withFees = (tokens ?? []).filter((t) => pending(t) > 0n);
  const totalUsd = withFees.reduce((s, t) => s + wei(pending(t)) * t.pair.usd, 0);
  const refresh = async () => { await qc.invalidateQueries({ queryKey: ["platformWaiting"] }); await qc.invalidateQueries({ queryKey: ["tokens"] }); };
  const collect = (label: string, list: Token[]) => async () => {
    await ensureWallet();
    await runTx(label, () => (list.length === 1 ? client.claimPlatformFees(list[0].address) : client.pushPlatformFees(list.map((t) => t.address))), refresh);
  };
  const isAddr = (v: string) => /^0x[0-9a-fA-F]{40}$/.test(v);
  const found = isAddr(lookup.trim()) ? tokens?.find((t) => t.address.toLowerCase() === lookup.trim().toLowerCase()) : undefined;
  const submitRecover = async () => {
    if (!recover) return;
    const pct = Number(recover.pct);
    if (!(pct > 0 && pct <= 100) || !isAddr(recover.to.trim())) return;
    const { t, to } = recover;
    setRecover(null);
    await call(`Recover ${t.symbol} liquidity`, "collect", [t.address, Math.round(pct * 100), to.trim() as Address])();
    await refresh();
  };
  const runRecoverAll = async () => {
    if (!recoverAll || !tokens) return;
    const pct = Number(recoverAll.pct);
    if (!(pct > 0 && pct <= 100) || !isAddr(recoverAll.to.trim())) return;
    const to = recoverAll.to.trim() as Address;
    // Pools that hold any pair asset first; empty launch positions still hold coins, so include them all.
    const list = [...tokens].sort((a, b) => wei(b.liquidityWei) * b.pair.usd - wei(a.liquidityWei) * a.pair.usd);
    setRecoverAll({ ...recoverAll, busy: true, done: 0, total: list.length });
    await ensureWallet();
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      const ok = await runTx(`Recover ${t.symbol} liquidity (${i + 1}/${list.length})`, () => client.adminCall("collect", [t.address, Math.round(pct * 100), to]));
      if (!ok) { setRecoverAll({ ...recoverAll, busy: false, done: i, total: list.length }); await refresh(); return; }
      setRecoverAll({ ...recoverAll, busy: true, done: i + 1, total: list.length });
    }
    setRecoverAll(null);
    await refresh();
  };
  const actions = (t: Token) => (
    <div className="row" style={{ justifyContent: "flex-end" }}>
      <button className="btn sm" disabled={pending(t) === 0n} onClick={collect(`Collect ${t.symbol} fees`, [t])}>Collect fees</button>
      <button className="btn sm danger" onClick={() => setRecover({ t, pct: "100", to: me ?? "" })}>Recover LP</button>
    </div>
  );
  return (
    <>
      <div className="sec-h">
        <h2>Coins</h2>
        <div className="tools">
          <span className="caps">{withFees.length} coin{withFees.length === 1 ? "" : "s"} · {usd(totalUsd, { compact: true })} waiting</span>
          <button className="btn ink" disabled={withFees.length === 0} onClick={collect(`Collect fees from ${withFees.length} coins`, withFees)}>Collect all fees</button>
          <button className="btn danger" disabled={!tokens?.length} onClick={() => setRecoverAll({ pct: "100", to: me ?? "", busy: false, done: 0, total: tokens?.length ?? 0 })}>Recover all LP</button>
        </div>
      </div>
      <div className="panel" style={{ padding: 18, marginBottom: 12 }}>
        <div className="caps" style={{ marginBottom: 8 }}>Manage a coin by address</div>
        <input className="inp" placeholder="Paste a coin contract address (0x…)" value={lookup} onChange={(e) => setLookup(e.target.value)} spellCheck={false} />
        {lookup.trim() && !isAddr(lookup.trim()) && <p className="note down">That is not a valid address.</p>}
        {isAddr(lookup.trim()) && !found && <p className="note down">This address is not a coin launched here.</p>}
        {found && (
          <div className="row" style={{ justifyContent: "space-between", marginTop: 12, flexWrap: "wrap", gap: 10 }}>
            <Link to={`/t/${found.address}`} className="coin"><Art src={found.metadata?.logo} name={found.name} className="art" /><b>{found.name}</b><small>{found.symbol} · {usd(found.marketCapUsd, { compact: true })} · {hype(wei(pending(found)), 5)} {found.pair.symbol} waiting</small></Link>
            {actions(found)}
          </div>
        )}
      </div>
      {!tokens || !waiting ? <div className="skeleton" style={{ height: 120 }} /> : (
        <div className="tbl" style={{ display: "block" }}><table>
          <thead><tr><th>Coin</th><th>Pair</th><th className="num">Market cap</th><th className="num">Fees waiting</th><th className="num">Collected</th><th className="num">Actions</th></tr></thead>
          <tbody>{tokens.map((t) => { const w = pending(t); const collected = t.rewards ? t.rewards.platform - w : 0n; return (
            <tr key={t.address}>
              <td><Link to={`/t/${t.address}`} className="coin"><Art src={t.metadata?.logo} name={t.name} className="art" /><b>{t.name}</b><small>{t.symbol}</small>{isHidden(t.address) && <span className="tag">hidden</span>}</Link></td>
              <td><span className={"tag " + (t.pair.isNative ? "" : "stock")}>{t.pair.symbol}</span></td>
              <td className="num">{usd(t.marketCapUsd, { compact: true })}</td>
              <td className={"num " + (w > 0n ? "up" : "faint")}>{hype(wei(w), 5)} {t.pair.symbol} · {usd(wei(w) * t.pair.usd)}</td>
              <td className="num dim">{hype(wei(collected > 0n ? collected : 0n), 4)} {t.pair.symbol}</td>
              <td className="num">{actions(t)}</td>
            </tr>); })}</tbody>
        </table></div>
      )}
      <p className="note">Collect fees harvests a coin's pool fees and pays the creator {FEES.creatorPct}% and the fee recipient {cfgPlatformPct}%; anyone can trigger it, the destinations cannot change. Recover LP is admin-only: it pulls that share of the launch position (coins and USDC) to a wallet you choose, and cannot be undone.</p>
      {recoverAll && (
        <div className="modal" onClick={() => !recoverAll.busy && setRecoverAll(null)}>
          <div className="panel" onClick={(e) => e.stopPropagation()}>
            <h3>Recover liquidity from every coin</h3>
            <p className="note" style={{ marginTop: 6 }}>Pulls the chosen share of each coin's launch position (coins and pair asset) to one recipient. The factory checks the admin on every call, so this is one transaction per coin: {tokens?.length ?? 0} confirmations, largest pools first. Not reversible, and trading on emptied pools stops working.</p>
            <div className="field" style={{ marginTop: 14 }}><label>Percent to remove (1–100)</label><input inputMode="decimal" value={recoverAll.pct} disabled={recoverAll.busy} onChange={(e) => setRecoverAll({ ...recoverAll, pct: e.target.value })} /></div>
            <div className="field" style={{ marginTop: 10 }}><label>Recipient</label><input value={recoverAll.to} disabled={recoverAll.busy} onChange={(e) => setRecoverAll({ ...recoverAll, to: e.target.value })} placeholder="0x…" spellCheck={false} /></div>
            {recoverAll.busy && <p className="note">Recovered {recoverAll.done} of {recoverAll.total}… confirm each one in your wallet.</p>}
            {!recoverAll.busy && recoverAll.done > 0 && <p className="note down">Stopped after {recoverAll.done} of {recoverAll.total}. Tap again to continue with the rest.</p>}
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn" style={{ flex: 1 }} disabled={recoverAll.busy} onClick={() => setRecoverAll(null)}>Cancel</button>
              <button className="btn danger" style={{ flex: 1 }} disabled={recoverAll.busy || !(Number(recoverAll.pct) > 0 && Number(recoverAll.pct) <= 100) || !isAddr(recoverAll.to.trim())} onClick={runRecoverAll}>Recover from {tokens?.length ?? 0} coins</button>
            </div>
          </div>
        </div>
      )}
      {recover && (
        <div className="modal" onClick={() => setRecover(null)}>
          <div className="panel" onClick={(e) => e.stopPropagation()}>
            <h3>Recover {recover.t.symbol} liquidity</h3>
            <p className="note" style={{ marginTop: 6 }}>Pulls pooled liquidity (coins and {recover.t.pair.symbol}) to a recipient. This is not reversible and lowers the pool's liquidity.</p>
            <div className="field" style={{ marginTop: 14 }}><label>Percent to remove (1–100)</label><input inputMode="decimal" value={recover.pct} onChange={(e) => setRecover({ ...recover, pct: e.target.value })} /></div>
            <div className="field" style={{ marginTop: 10 }}><label>Recipient</label><input value={recover.to} onChange={(e) => setRecover({ ...recover, to: e.target.value })} placeholder="0x…" spellCheck={false} /></div>
            <div className="row" style={{ marginTop: 16 }}>
              <button className="btn" style={{ flex: 1 }} onClick={() => setRecover(null)}>Cancel</button>
              <button className="btn down" style={{ flex: 1 }} disabled={!(Number(recover.pct) > 0 && Number(recover.pct) <= 100) || !isAddr(recover.to.trim())} onClick={submitRecover}>Recover</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const cfgPlatformPct = FEES.platformPct;
