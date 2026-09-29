import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Address } from "viem";
import { useAccount } from "wagmi";

import { Art } from "../components/Art";
import { Copy } from "../components/Copy";
import { client, type QuoteView } from "../lib/client";
import { ADDRESSES } from "../lib/env";
import { hype, num, short, usd, wei } from "../lib/format";
import { runTx, useConfig, useIsAdmin, useQuotes, useTokens, type Token } from "../lib/hooks";
import { ensureWallet, openWalletModal } from "../lib/wallet";

type Fn = Parameters<typeof client.adminCall>[0];
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const isAddr = (v?: string) => /^0x[0-9a-fA-F]{40}$/.test(v ?? "");

/** Hidden admin page. Not linked unless the admin wallet is connected; every send reverts for anyone else. */
export default function Admin() {
  const { address: me, isConnected } = useAccount();
  const admin = useIsAdmin();
  const { data: cfg } = useConfig();
  const { data: tokens } = useTokens();
  const qc = useQueryClient();
  const [feeTo, setFeeTo] = useState("");
  const call = (label: string, fn: Fn, args: unknown[] = []) => async () => {
    if (!isConnected) return openWalletModal();
    await ensureWallet();
    await runTx(label, () => client.adminCall(fn, args), async () => { await qc.invalidateQueries(); });
  };
  if (!isConnected) return <main className="gate"><h1>Admin.</h1><p className="lede">Connect the admin wallet.</p><button className="btn pri" onClick={() => openWalletModal()}>Connect wallet</button></main>;

  return (
    <main className="adm">
      <div className="adm-top"><div><h1>Admin</h1><p className="lede">Factory <span className="num">{short(ADDRESSES.factory)}</span> on Ethereum.</p></div></div>
      <div className="adm-status"><span className={"badge " + (admin ? "up" : "down")}>{admin ? `Admin · ${short(me!)}` : `Not admin · ${short(me!)}`}</span>{cfg && <span className="badge mute" title={cfg.admin}>Admin {short(cfg.admin)}</span>}</div>

      <div className="adm-grid">
        <div className="card"><h3>Platform</h3>
          <div className="kv"><span>Launches</span><b className={cfg?.paused ? "down" : "up"}>{cfg ? (cfg.paused ? "Paused" : "Open") : "…"}</b></div>
          <div className="kv"><span>Fee recipient</span><b>{cfg ? <Copy value={cfg.feeRecipient} /> : "…"}</b></div>
          <div className="kv"><span>Owner</span><b>{cfg ? (cfg.owner === ZERO ? "Renounced" : short(cfg.owner)) : "…"}</b></div>
          <div className="kv"><span>Fee</span><b>{cfg ? `${cfg.taxBps / 100}% · ${cfg.creatorBps / 100} / ${cfg.holderBps / 100} / ${(10000 - cfg.creatorBps - cfg.holderBps) / 100}` : "…"}</b></div>
          <div className="kv"><span>Coins</span><b>{cfg ? num(cfg.totalTokens, 0) : "…"}</b></div>
          <div className="adm-actions">{cfg?.paused ? <button className="btn dim" onClick={call("Resume launches", "resume")}>Resume launches</button> : <button className="btn dim" onClick={call("Pause launches", "pause")}>Pause launches</button>}</div>
        </div>
        <div className="card"><h3>Fee recipient</h3><p className="adm-help">Where the platform share of every coin's fees goes. Point this at the STONK distributor once it exists.</p>
          <label className="lf-f"><span>Address</span><input placeholder={cfg?.feeRecipient ?? "0x…"} value={feeTo} onChange={(e) => setFeeTo(e.target.value)} spellCheck={false} /></label>
          <div className="adm-actions"><button className="btn pri" disabled={!isAddr(feeTo)} onClick={call("Set fee recipient", "setFeeRecipient", [feeTo as Address])}>Set fee recipient</button></div>
        </div>
      </div>

      <Coins tokens={tokens} call={call} />
      <div className="sec"><h2>Pair assets</h2></div>
      <Quotes call={call} />
      <p className="note"><Link to="/">Back to coins</Link></p>
    </main>
  );
}

function Coins({ tokens, call }: { tokens?: Token[]; call: (label: string, fn: Fn, args?: unknown[]) => () => Promise<void> }) {
  const qc = useQueryClient();
  const { address: me } = useAccount();
  const [edit, setEdit] = useState<Record<string, { tax?: string; uri?: string; pct?: string; to?: string }>>({});
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
  const push = (label: string, list: Token[]) => async () => { await ensureWallet(); await runTx(label, () => (list.length === 1 ? client.claimPlatformFees(list[0].address) : client.pushPlatformFees(list.map((t) => t.address))), refresh); };
  const e = (t: Token) => edit[t.address] ?? {};
  const setE = (t: Token, patch: Record<string, string>) => setEdit({ ...edit, [t.address]: { ...e(t), ...patch } });
  return (
    <>
      <div className="sec"><h2>Coins</h2><div className="rowb"><span className="badge mute">{usd(totalUsd)} platform fees waiting</span><button className="btn dim sm" disabled={withFees.length === 0} onClick={push(`Push fees from ${withFees.length} coins`, withFees)}>Push all</button></div></div>
      {!tokens ? <div className="skel" style={{ height: 120 }} /> : tokens.length === 0 ? <div className="adm-empty">No coins launched yet.</div> : (
        <div className="adm-coins">{tokens.map((t) => { const w = pending(t); const x = e(t); const taxBps = Math.round(Number(x.tax ?? "") * 100); const lp = Math.round(Number(x.pct ?? "") * 100); return (
          <div key={t.address} className={"adm-coin " + (t.hidden ? "hid" : "")}>
            <div className="adm-coin-h"><Art src={t.metadata?.logo} address={t.address} size="sm" /><b>{t.symbol}</b><span className={"badge " + (t.pair.isNative ? "eth" : "stock")}>{t.pair.symbol}</span>{t.hidden && <span className="badge down">hidden</span>}<Copy value={t.address} /><Link className="badge mute" to={`/t/${t.address}`}>Open</Link></div>
            <div className="adm-coin-m"><span>Creator <b className="num">{short(t.creator)}</b></span><span>Tax <b className="num">{(t.feeTier / 100).toFixed(2)}%</b></span><span>Mcap <b className="num">{usd(t.marketCapUsd, { compact: true })}</b></span><span>Liquidity <b className="num">{usd(wei(t.liquidityWei) * t.pair.usd, { compact: true })}</b></span><span>Platform fees <b className="num">{hype(wei(w), 5)} {t.pair.symbol}</b></span></div>
            <div className="adm-coin-a">
              <button className="btn dim sm" onClick={call(t.hidden ? `Unhide ${t.symbol}` : `Hide ${t.symbol}`, "setHidden", [t.address, !t.hidden])}>{t.hidden ? "Unhide" : "Hide"}</button>
              <button className="btn dim sm" disabled={w === 0n} onClick={push(`Push ${t.symbol} fees`, [t])}>Push fees</button>
              <span className="adm-inline"><input placeholder="tax %" inputMode="decimal" value={x.tax ?? ""} onChange={(ev) => setE(t, { tax: ev.target.value })} /><button className="btn dim sm" disabled={!(taxBps >= 0 && taxBps <= 1000 && x.tax)} onClick={call(`Set ${t.symbol} tax`, "setCoinTax", [t.address, taxBps])}>Set tax</button></span>
              <span className="adm-inline"><input placeholder="metadata JSON or URI" value={x.uri ?? ""} onChange={(ev) => setE(t, { uri: ev.target.value })} style={{ width: 200 }} /><button className="btn dim sm" disabled={!x.uri} onClick={call(`Set ${t.symbol} metadata`, "setCoinMetadata", [t.address, x.uri ?? ""])}>Set metadata</button></span>
              <span className="adm-inline"><input placeholder="% of LP" inputMode="decimal" value={x.pct ?? ""} onChange={(ev) => setE(t, { pct: ev.target.value })} /><input placeholder={me ? short(me) : "to 0x…"} value={x.to ?? ""} onChange={(ev) => setE(t, { to: ev.target.value })} spellCheck={false} /><button className="btn sellb sm" disabled={!(lp > 0 && lp <= 10000) || !isAddr(x.to || me)} onClick={async () => { if (!confirm(`Pull ${lp / 100}% of ${t.symbol}'s liquidity out of the pool? This cannot be undone.`)) return; await call(`Collect ${t.symbol} liquidity`, "collect", [t.address, lp, (x.to || me) as Address])(); }}>Collect</button></span>
            </div>
          </div>); })}</div>
      )}
    </>
  );
}

function Quotes({ call }: { call: (label: string, fn: Fn, args?: unknown[]) => () => Promise<void> }) {
  const { data: quotes } = useQuotes();
  const [px, setPx] = useState<Record<string, string>>({});
  const [feed, setFeed] = useState<Record<string, string>>({});
  const [add, setAdd] = useState({ address: "", usd: "", feed: "" });
  const [q, setQ] = useState("");
  if (!quotes) return <div className="skel" style={{ height: 120 }} />;
  const usd8 = (v: string) => BigInt(Math.round(Number(v || "0") * 1e8));
  const list = quotes.filter((x) => !q || `${x.symbol} ${x.name}`.toLowerCase().includes(q.toLowerCase())).slice(0, q ? 200 : 20);
  return (
    <>
      <div className="card">
        <h3>Add a pair asset</h3>
        <label className="lf-f"><span>Token</span><input placeholder="ERC20 on Ethereum, 18 decimals" value={add.address} onChange={(e) => setAdd({ ...add, address: e.target.value })} spellCheck={false} /></label>
        <div className="adm-row"><label className="lf-f"><span>USD</span><input inputMode="decimal" placeholder="224.55" value={add.usd} onChange={(e) => setAdd({ ...add, usd: e.target.value })} /></label><label className="lf-f"><span>Feed</span><input placeholder="Chainlink, optional" value={add.feed} onChange={(e) => setAdd({ ...add, feed: e.target.value })} spellCheck={false} /></label></div>
        <div className="adm-actions"><button className="btn pri" disabled={!isAddr(add.address) || (!(Number(add.usd) > 0) && !isAddr(add.feed))} onClick={call("Approve pair asset", "setQuoteAsset", [add.address as Address, true, usd8(add.usd), (isAddr(add.feed) ? add.feed : ZERO) as Address])}>Approve</button></div>
      </div>
      <label className="lf-search" style={{ marginTop: 10, border: "1px solid var(--hair)", borderRadius: 12, background: "var(--card)" }}><input placeholder="Filter pairs" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      <div className="adm-coins" style={{ marginTop: 10 }}>{list.map((x: QuoteView) => (
        <div key={x.address} className="adm-coin">
          <div className="adm-coin-h"><b>{x.symbol}</b><span className="lf-hint">{x.name}</span>{!x.approved && <span className="badge down">retired</span>}{x.ethRoute && !x.isNative && <span className="badge up">ETH route</span>}<Copy value={x.address} /></div>
          <div className="adm-coin-m"><span>Price on file <b className="num">{usd(x.usd)}</b></span><span>Pool <b className="num">{x.liqUsd > 0 ? usd(x.liqUsd, { compact: true }) : "—"}</b></span></div>
          <div className="adm-coin-a"><span className="adm-inline"><input inputMode="decimal" placeholder="USD" value={px[x.address] ?? ""} onChange={(e) => setPx({ ...px, [x.address]: e.target.value })} /><input placeholder="feed (opt)" value={feed[x.address] ?? ""} onChange={(e) => setFeed({ ...feed, [x.address]: e.target.value })} spellCheck={false} /><button className="btn dim sm" disabled={!(Number(px[x.address]) > 0) && !isAddr(feed[x.address])} onClick={call(`Price ${x.symbol}`, "setQuoteAsset", [x.address, true, usd8(px[x.address] ?? "0"), (isAddr(feed[x.address]) ? feed[x.address] : ZERO) as Address])}>{x.approved ? "Set" : "Approve"}</button>{x.approved && !x.isNative && <button className="btn dim sm" onClick={call(`Retire ${x.symbol}`, "setQuoteAsset", [x.address, false, 0n, ZERO])}>Retire</button>}</span></div>
        </div>))}</div>
    </>
  );
}
