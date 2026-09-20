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
import { runTx, useConfig, useIsAdmin, useQuotes, useTokens, type Token } from "../lib/hooks";
import { isTokenPair } from "../lib/stocks";
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
  if (!isConnected) return <main className="gate"><h1>Platform admin.</h1><p>Connect the admin wallet.</p><button className="b pri" onClick={() => openWalletModal()}>Connect wallet</button></main>;

  return (
    <main>
      <div className="sec-h" style={{ marginTop: 0 }}><h2>Admin · {short(me!)}</h2><span className={"chip " + (admin ? "up" : "")}>{admin ? "admin" : "read only"}</span></div>
      {!admin && <div className="warn">This wallet is not the factory admin. Actions will revert. Admin: {cfg ? short(cfg.admin) : "…"}</div>}
      <section className="sec" style={{ marginTop: 16 }}>
        <div className="pane pad"><dl className="kv" style={{ margin: 0 }}>
          <dt>Factory</dt><dd><Copy value={ADDRESSES.factory} full /></dd>
          <dt>Hook</dt><dd><Copy value={ADDRESSES.hook} full /></dd>
          <dt>Router</dt><dd><Copy value={ADDRESSES.router} full /></dd>
          <dt>Admin</dt><dd>{cfg ? <Copy value={cfg.admin} full /> : "…"}</dd>
          <dt>Owner</dt><dd>{cfg ? (cfg.owner === ZERO ? "renounced" : <Copy value={cfg.owner} full />) : "…"}</dd>
          <dt>Fee recipient</dt><dd>{cfg ? <Copy value={cfg.feeRecipient} full /> : "…"}</dd>
          <dt>Launches</dt><dd>{cfg ? (cfg.paused ? <span className="down">Paused</span> : <span className="up">Open</span>) : "…"}</dd>
          <dt>Fee</dt><dd>{cfg ? `${cfg.taxBps / 100}% · ${cfg.creatorBps / 100} / ${cfg.holderBps / 100} / ${(10000 - cfg.creatorBps - cfg.holderBps) / 100}` : "…"}</dd>
          <dt>ETH on file</dt><dd>{cfg ? usd(cfg.ethUsd) : "…"}</dd>
          <dt>Coins</dt><dd>{cfg ? num(cfg.totalTokens, 0) : "…"}</dd>
        </dl></div>
      </section>
      <section className="sec two">
        <div className="pane pad">
          <h3>Launches</h3>
          <div style={{ marginTop: 10 }}>{cfg?.paused ? <button className="b horn" onClick={call("Resume launches", "resume")}>Resume launches</button> : <button className="b ghost" onClick={call("Pause launches", "pause")}>Pause launches</button>}</div>
          <p className="note">Pausing blocks new launches only. Trading, rewards and claims keep running.</p>
        </div>
        <div className="pane pad">
          <h3>Fee recipient</h3>
          <div className="row" style={{ marginTop: 10 }}><input className="in" style={{ flex: 1 }} placeholder={cfg?.feeRecipient ?? "0x…"} value={f.feeTo} onChange={set("feeTo")} /><button className="b ghost" disabled={!/^0x[0-9a-fA-F]{40}$/.test(f.feeTo)} onClick={call("Set fee recipient", "setFeeRecipient", [f.feeTo as Address])}>Set</button></div>
          <p className="note">Where every coin's platform share goes when anyone pushes it.</p>
        </div>
      </section>
      <section className="sec"><Fees tokens={tokens} call={call} /></section>
      <section className="sec"><div className="sec-h"><h2>Pair assets</h2></div><Quotes call={call} /></section>
      <p className="note"><Link to="/" className="vi">Back to coins</Link></p>
    </main>
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
  const isAddr = (v?: string) => /^0x[0-9a-fA-F]{40}$/.test(v ?? "");
  const list = quotes.filter((x) => !q || `${x.symbol} ${x.name}`.toLowerCase().includes(q.toLowerCase()));
  const row = (x: QuoteView) => (
    <tr key={x.address}>
      <td><b>{x.symbol}</b> <span className="faint">{x.name}</span> {!x.isNative && <span className={"chip " + (isTokenPair(x.address) ? "token" : "stock")}>{isTokenPair(x.address) ? "token" : "stock"}</span>} {!x.approved && <span className="chip">retired</span>} {x.ethRoute && !x.isNative && <span className="chip up">ETH route</span>}</td>
      <td><Copy value={x.address} /></td>
      <td className="num">{usd(x.usd)}</td>
      <td className="num dim">{x.liqUsd > 0 ? usd(x.liqUsd, { compact: true }) : "—"}</td>
      <td><div className="row"><input className="in" style={{ width: 96 }} inputMode="decimal" placeholder="USD" value={px[x.address] ?? ""} onChange={(e) => setPx({ ...px, [x.address]: e.target.value })} /><input className="in" style={{ width: 140 }} placeholder="feed (opt)" value={feed[x.address] ?? ""} onChange={(e) => setFeed({ ...feed, [x.address]: e.target.value })} /><button className="b ghost sm" disabled={!(Number(px[x.address]) > 0) && !isAddr(feed[x.address])} onClick={call(`Price ${x.symbol}`, "setQuoteAsset", [x.address, true, usd8(px[x.address] ?? "0"), (isAddr(feed[x.address]) ? feed[x.address] : ZERO) as Address])}>{x.approved ? "Set" : "Approve"}</button>{x.approved && !x.isNative && <button className="b danger sm" onClick={call(`Retire ${x.symbol}`, "setQuoteAsset", [x.address, false, 0n, ZERO])}>Retire</button>}</div></td>
    </tr>
  );
  return (
    <>
      <div className="tools" style={{ marginBottom: 10 }}><input className="in" placeholder="Filter pairs" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="tbl"><table>
        <thead><tr><th>Pair</th><th>Address</th><th className="num">Price on file</th><th className="num">Pool</th><th>Update</th></tr></thead>
        <tbody>{list.map(row)}</tbody>
      </table></div>
      <div className="pane pad" style={{ marginTop: 12 }}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>Add a pair asset</div>
        <div className="row">
          <input className="in" style={{ flex: 2, minWidth: 260 }} placeholder="ERC20 address on Ethereum (18 decimals)" value={add.address} onChange={(e) => setAdd({ ...add, address: e.target.value })} />
          <input className="in" style={{ width: 150 }} inputMode="decimal" placeholder="USD per token" value={add.usd} onChange={(e) => setAdd({ ...add, usd: e.target.value })} />
          <input className="in" style={{ width: 210 }} placeholder="Chainlink feed (optional)" value={add.feed} onChange={(e) => setAdd({ ...add, feed: e.target.value })} />
          <button className="b horn" disabled={!isAddr(add.address) || (!(Number(add.usd) > 0) && !isAddr(add.feed))} onClick={call("Approve pair asset", "setQuoteAsset", [add.address as Address, true, usd8(add.usd), (isAddr(add.feed) ? add.feed : ZERO) as Address])}>Approve</button>
        </div>
        <p className="note">Any 18-decimal ERC-20 works. A Chainlink feed, when set and fresh, overrides the USD price. The price sizes the $3k opening pool of every coin launched on that pair. Retiring stops new launches; existing coins keep trading. ETH cannot be retired. For buyers to pay in ETH the site also needs the token's WETH pool in its route table.</p>
      </div>
    </>
  );
}

/** Every coin: platform fees to collect, holder rewards to push, admin-only liquidity recovery. */
function Fees({ tokens, call }: { tokens?: Token[]; call: (label: string, fn: Fn, args?: unknown[]) => () => Promise<void> }) {
  const qc = useQueryClient();
  const { address: me } = useAccount();
  const [lookup, setLookup] = useState("");
  const [recover, setRecover] = useState<{ t: Token; pct: string; to: string } | null>(null);
  const [push, setPush] = useState<{ t: Token; list: { address: Address; pending: bigint }[]; busy: boolean; done: number } | null>(null);
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
  const BATCH = 60;
  const openPush = (t: Token) => async () => {
    setPush({ t, list: [], busy: true, done: 0 });
    try { const list = await client.holdersWithPending(t.address); setPush({ t, list, busy: false, done: 0 }); } catch { setPush(null); }
  };
  const runPush = async () => {
    if (!push || push.list.length === 0) return;
    await ensureWallet();
    const { t, list } = push;
    setPush({ ...push, busy: true });
    for (let i = 0; i < list.length; i += BATCH) {
      const batch = list.slice(i, i + BATCH).map((h) => h.address);
      const ok = await runTx(`Push ${t.symbol} rewards ${i / BATCH + 1}/${Math.ceil(list.length / BATCH)}`, () => client.pushRewards(t.address, batch));
      if (!ok) { setPush({ ...push, busy: false, done: i }); return; }
      setPush({ t, list, busy: true, done: Math.min(list.length, i + BATCH) });
    }
    setPush(null);
    await refresh();
  };
  const actions = (t: Token) => (
    <div className="row" style={{ justifyContent: "flex-end" }}>
      <button className="b ghost sm" disabled={pending(t) === 0n} onClick={collect(`Collect ${t.symbol} fees`, [t])}>Collect fees</button>
      <button className="b ghost sm" onClick={openPush(t)}>Push rewards</button>
      <button className="b danger sm" onClick={() => setRecover({ t, pct: "100", to: me ?? "" })}>Recover LP</button>
    </div>
  );
  return (
    <>
      <div className="sec-h">
        <h2>Coins</h2>
        <div className="row"><span className="eyebrow">{withFees.length} coin{withFees.length === 1 ? "" : "s"} · {usd(totalUsd, { compact: true })} waiting</span><button className="b pri" disabled={withFees.length === 0} onClick={collect(`Collect fees from ${withFees.length} coins`, withFees)}>Collect all fees</button></div>
      </div>
      <div className="pane pad" style={{ marginBottom: 12 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Manage a coin by address</div>
        <input className="in" placeholder="Paste a coin contract address (0x…)" value={lookup} onChange={(e) => setLookup(e.target.value)} spellCheck={false} />
        {lookup.trim() && !isAddr(lookup.trim()) && <p className="note down">That is not a valid address.</p>}
        {isAddr(lookup.trim()) && !found && <p className="note down">This address is not a coin launched here.</p>}
        {found && <div className="row" style={{ justifyContent: "space-between", marginTop: 12 }}><Link to={`/t/${found.address}`} className="row"><Art src={found.metadata?.logo} name={found.name} className="art" /><span><b>{found.name}</b> <small className="faint">{found.symbol} · {usd(found.marketCapUsd, { compact: true })} · {hype(wei(pending(found)), 5)} {found.pair.symbol} waiting</small></span></Link>{actions(found)}</div>}
      </div>
      {!tokens || !waiting ? <div className="skel" style={{ height: 120 }} /> : (
        <div className="tbl"><table>
          <thead><tr><th>Coin</th><th>Pair</th><th className="num">Market cap</th><th className="num">Fees waiting</th><th className="num">Paid to holders</th><th className="num">Actions</th></tr></thead>
          <tbody>{tokens.map((t) => { const w = pending(t); return (
            <tr key={t.address}>
              <td><Link to={`/t/${t.address}`} className="coin"><Art src={t.metadata?.logo} name={t.name} className="art" /><span><b>{t.name}</b><small>{t.symbol}{isHidden(t.address) ? " · hidden" : ""}</small></span></Link></td>
              <td><span className={"chip " + (t.pair.isNative ? "eth" : isTokenPair(t.pair.address) ? "token" : "stock")}>{t.pair.symbol}</span></td>
              <td className="num">{usd(t.marketCapUsd, { compact: true })}</td>
              <td className={"num " + (w > 0n ? "up" : "faint")}>{hype(wei(w), 5)} {t.pair.symbol} · {usd(wei(w) * t.pair.usd)}</td>
              <td className="num vi">{t.rewards ? usd(wei(t.rewards.holders) * t.pair.usd, { compact: true }) : "—"}</td>
              <td className="num">{actions(t)}</td>
            </tr>); })}</tbody>
        </table></div>
      )}
      <p className="note">Collect fees sends a coin's {FEES.platformPct}% platform share to the fee recipient; anyone can trigger it, the destination cannot change. Push rewards pays every holder's unclaimed share to their own wallet in the pair asset; anyone can trigger it, you only pay gas. Recover LP is admin-only: it pulls that share of the launch position (coins and pair) to a wallet you choose, and cannot be undone.</p>
      {push && (
        <div className="modal" onClick={() => !push.busy && setPush(null)}>
          <div className="pane" onClick={(e) => e.stopPropagation()}>
            <h3>Push {push.t.symbol} rewards to holders</h3>
            {push.busy && push.list.length === 0 ? <p className="note">Reading holders…</p> : (
              <>
                <p className="note">{push.list.length} holder{push.list.length === 1 ? "" : "s"} have unclaimed rewards, {hype(wei(push.list.reduce((s, h) => s + h.pending, 0n)), 4)} {push.t.pair.symbol} in total ({usd(wei(push.list.reduce((s, h) => s + h.pending, 0n)) * push.t.pair.usd, { compact: true })}). Each one receives their share in {push.t.pair.symbol}. You pay the gas, about {Math.ceil(push.list.length / BATCH)} transaction{push.list.length > BATCH ? "s" : ""}.</p>
                {push.list.length > 0 && <div className="tbl" style={{ maxHeight: 220, marginTop: 10 }}><table><tbody>{push.list.slice(0, 50).map((h) => <tr key={h.address}><td><a href={`${env.explorerUrl}/address/${h.address}`} target="_blank" rel="noreferrer">{short(h.address)}</a></td><td className="num">{hype(wei(h.pending), 5)} {push.t.pair.symbol}</td></tr>)}</tbody></table>{push.list.length > 50 && <p className="note">and {push.list.length - 50} more</p>}</div>}
                {push.busy && <p className="note">Sent to {push.done} of {push.list.length}…</p>}
                <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
                  <button className="b ghost" disabled={push.busy} onClick={() => setPush(null)}>Cancel</button>
                  <button className="b pri" disabled={push.busy || push.list.length === 0} onClick={runPush}>Push to {push.list.length} holder{push.list.length === 1 ? "" : "s"}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {recover && (
        <div className="modal" onClick={() => setRecover(null)}>
          <div className="pane" onClick={(e) => e.stopPropagation()}>
            <h3>Recover {recover.t.symbol} liquidity</h3>
            <p className="note" style={{ marginTop: 6 }}>Pulls pooled liquidity (coins and {recover.t.pair.symbol}) to a recipient. This is not reversible and lowers the pool's liquidity.</p>
            <div className="f" style={{ marginTop: 14 }}><label>Percent to remove (1–100)</label><input className="in" inputMode="decimal" value={recover.pct} onChange={(e) => setRecover({ ...recover, pct: e.target.value })} /></div>
            <div className="f"><label>Recipient</label><input className="in" value={recover.to} onChange={(e) => setRecover({ ...recover, to: e.target.value })} placeholder="0x…" spellCheck={false} /></div>
            <div className="row" style={{ marginTop: 16 }}>
              <button className="b ghost" style={{ flex: 1 }} onClick={() => setRecover(null)}>Cancel</button>
              <button className="b sell" style={{ flex: 1 }} disabled={!(Number(recover.pct) > 0 && Number(recover.pct) <= 100) || !isAddr(recover.to.trim())} onClick={submitRecover}>Recover</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
