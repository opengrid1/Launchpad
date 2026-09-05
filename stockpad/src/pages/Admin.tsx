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
      <section className="sec">
        <div className="steps two">
          <div className="step">
            <div className="step-h"><h3>Launches</h3></div>
            {cfg?.paused ? <button className="btn acc" onClick={call("Resume launches", "resume")}>Resume launches</button> : <button className="btn" onClick={call("Pause launches", "pause")}>Pause launches</button>}
            <p className="note">Pausing blocks new launches only. Trading, rewards and claims keep running.</p>
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
      <section className="sec">
        <div className="sec-h"><h2>Pair assets</h2></div>
        <Quotes call={call} />
      </section>
      <p className="note"><Link to="/" className="acc">Back to coins</Link></p>
    </main>
  );
}

function Quotes({ call }: { call: (label: string, fn: Fn, args?: unknown[]) => () => Promise<void> }) {
  const { data: quotes } = useQuotes();
  const [px, setPx] = useState<Record<string, string>>({});
  const [feed, setFeed] = useState<Record<string, string>>({});
  const [add, setAdd] = useState({ address: "", usd: "", feed: "" });
  const [q, setQ] = useState("");
  if (!quotes) return <div className="skeleton" style={{ height: 120 }} />;
  const usd8 = (v: string) => BigInt(Math.round(Number(v || "0") * 1e8));
  const isAddr = (v?: string) => /^0x[0-9a-fA-F]{40}$/.test(v ?? "");
  const list = quotes.filter((x) => !q || `${x.symbol} ${x.name}`.toLowerCase().includes(q.toLowerCase()));
  const row = (x: QuoteView) => (
    <tr key={x.address}>
      <td><b>{x.symbol}</b> <span className="faint">{x.name}</span> {!x.approved && <span className="tag">retired</span>} {x.ethRoute && !x.isNative && <span className="tag up">ETH route</span>}</td>
      <td><Copy value={x.address} /></td>
      <td className="num">{usd(x.usd)}</td>
      <td className="num dim">{x.liqUsd > 0 ? usd(x.liqUsd, { compact: true }) : "—"}</td>
      <td><div className="row"><input className="inp" style={{ width: 96 }} inputMode="decimal" placeholder="USD" value={px[x.address] ?? ""} onChange={(e) => setPx({ ...px, [x.address]: e.target.value })} /><input className="inp" style={{ width: 140 }} placeholder="feed (opt)" value={feed[x.address] ?? ""} onChange={(e) => setFeed({ ...feed, [x.address]: e.target.value })} /><button className="btn sm" disabled={!(Number(px[x.address]) > 0) && !isAddr(feed[x.address])} onClick={call(`Price ${x.symbol}`, "setQuoteAsset", [x.address, true, usd8(px[x.address] ?? "0"), (isAddr(feed[x.address]) ? feed[x.address] : ZERO) as Address])}>{x.approved ? "Set" : "Approve"}</button>{x.approved && !x.isNative && <button className="btn sm ghost" onClick={call(`Retire ${x.symbol}`, "setQuoteAsset", [x.address, false, 0n, ZERO])}>Retire</button>}</div></td>
    </tr>
  );
  return (
    <>
      <div className="tools" style={{ marginBottom: 10 }}><input className="inp" style={{ width: 260 }} placeholder="Filter pairs" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="tbl" style={{ display: "block" }}><table>
        <thead><tr><th>Pair</th><th>Address</th><th className="num">Price on file</th><th className="num">Pool</th><th>Update</th></tr></thead>
        <tbody>{list.map(row)}</tbody>
      </table></div>
      <div className="panel" style={{ marginTop: 12, padding: 18 }}>
        <div className="caps" style={{ marginBottom: 10 }}>Add a pair asset</div>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <input className="inp" style={{ flex: 2, minWidth: 260 }} placeholder="ERC20 address on Ethereum (18 decimals)" value={add.address} onChange={(e) => setAdd({ ...add, address: e.target.value })} />
          <input className="inp" style={{ width: 150 }} inputMode="decimal" placeholder="USD per token" value={add.usd} onChange={(e) => setAdd({ ...add, usd: e.target.value })} />
          <input className="inp" style={{ width: 210 }} placeholder="Chainlink feed (optional)" value={add.feed} onChange={(e) => setAdd({ ...add, feed: e.target.value })} />
          <button className="btn acc" disabled={!isAddr(add.address) || (!(Number(add.usd) > 0) && !isAddr(add.feed))} onClick={call("Approve pair asset", "setQuoteAsset", [add.address as Address, true, usd8(add.usd), (isAddr(add.feed) ? add.feed : ZERO) as Address])}>Approve</button>
        </div>
        <p className="note">A Chainlink feed, when set and fresh, overrides the USD price. The price sizes the $3k opening pool of every coin launched on that pair. Retiring stops new launches; existing coins keep trading. ETH cannot be retired.</p>
      </div>
    </>
  );
}

/** Every coin: platform fees waiting (collect per coin or all at once) and
 *  admin-only liquidity recovery, like the Robinhood launchpad admin. */
function Fees({ tokens, call }: { tokens?: Token[]; call: (label: string, fn: Fn, args?: unknown[]) => () => Promise<void> }) {
  const qc = useQueryClient();
  const { address: me } = useAccount();
  const [lookup, setLookup] = useState("");
  const [recover, setRecover] = useState<{ t: Token; pct: string; to: string } | null>(null);
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
      <p className="note">Collect fees sends a coin's {cfgPlatformPct}% platform share to the fee recipient; anyone can trigger it, the destination cannot change. Recover LP is admin-only: it pulls that share of the launch position (coins and pair) to a wallet you choose, and cannot be undone.</p>
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
