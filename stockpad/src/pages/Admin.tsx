import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { parseEther, type Address } from "viem";
import { useAccount } from "wagmi";

import { Art } from "../components/Art";
import { Copy } from "../components/Copy";
import { client, type QuoteView } from "../lib/client";
import { ADDRESSES, env, isHidden } from "../lib/env";
import { hype, num, short, usd, wei } from "../lib/format";
import { runTx, useConfig, useIsAdmin, useQuotes, useTokens, type Token } from "../lib/hooks";
import { ensureWallet, openWalletModal } from "../lib/wallet";

type Fn = Parameters<typeof client.adminCall>[0];

/** Platform admin: the immutable admin's factory controls. */
export default function Admin() {
  const { address: me, isConnected } = useAccount();
  const admin = useIsAdmin();
  const { data: cfg } = useConfig();
  const { data: tokens } = useTokens();
  const qc = useQueryClient();
  const [f, setF] = useState({ feeTo: "", asset: "", amount: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const call = (label: string, fn: Fn, args: unknown[] = []) => async () => {
    if (!isConnected) return openWalletModal();
    await ensureWallet();
    await runTx(label, () => client.adminCall(fn, args), async () => { await qc.invalidateQueries(); });
  };

  if (!isConnected) return <main className="page"><section className="hero" style={{ gridTemplateColumns: "1fr" }}><div><div className="lbl" style={{ marginBottom: 12 }}>Admin</div><h1>Platform <em>admin</em>.</h1><p className="sub">Connect the admin wallet.</p><div className="cta"><button className="btn red" onClick={() => openWalletModal()}>Connect wallet</button></div></div></section></main>;

  return (
    <main className="page admin">
      <section className="sec">
        <div className="lbl" style={{ marginBottom: 12 }}>Admin · {short(me!)}{admin ? " · admin" : " · read only"}</div>
        <h1 style={{ fontSize: 56 }}>Platform <em>admin</em>.</h1>
        {!admin && <p className="warn" style={{ marginTop: 12 }}>This wallet is not the factory admin. Actions will revert. Admin: {cfg ? short(cfg.admin) : "…"}</p>}
      </section>

      <section className="sec">
        <div className="sec-h"><h2>Platform</h2></div>
        <div className="panel">
          <dl className="specs">
            <dt>Factory</dt><dd><Copy value={ADDRESSES.factory} full /></dd>
            <dt>Hook</dt><dd><Copy value={ADDRESSES.hook} full /></dd>
            <dt>Router</dt><dd><Copy value={ADDRESSES.router} full /></dd>
            <dt>Admin</dt><dd>{cfg ? <Copy value={cfg.admin} full /> : "…"}</dd>
            <dt>Owner</dt><dd>{cfg ? (cfg.owner === "0x0000000000000000000000000000000000000000" ? "renounced" : <Copy value={cfg.owner} full />) : "…"}</dd>
            <dt>Fee recipient</dt><dd>{cfg ? <Copy value={cfg.feeRecipient} full /> : "…"}</dd>
            <dt>Launches</dt><dd>{cfg ? (cfg.paused ? "PAUSED" : "open") : "…"}</dd>
            <dt>Fee</dt><dd>{cfg ? `${cfg.taxBps / 100}% · ${cfg.creatorBps / 100}% creator · ${cfg.holderBps / 100}% holders · ${(10000 - cfg.creatorBps - cfg.holderBps) / 100}% platform` : "…"}</dd>
            <dt>ETH price on file</dt><dd>{cfg ? usd(cfg.ethUsd) : "…"}</dd>
            <dt>Coins</dt><dd>{cfg ? num(cfg.totalTokens, 0) : "…"}</dd>
          </dl>
        </div>
        <div className="agrid">
          <div className="panel">
            <div className="lbl" style={{ marginBottom: 10 }}>Launches</div>
            <div className="row" style={{ flexWrap: "wrap" }}>
              {cfg?.paused ? <button className="btn" onClick={call("Resume launches", "resume")}>Resume launches</button> : <button className="btn ghost" onClick={call("Pause launches", "pause")}>Pause launches</button>}
            </div>
            <p className="note">Pausing blocks new launches only. Trading, rewards and claims keep running.</p>
          </div>
          <div className="panel">
            <div className="lbl" style={{ marginBottom: 10 }}>Fee recipient</div>
            <div className="row"><input className="inp" placeholder={cfg?.feeRecipient ?? "0x…"} value={f.feeTo} onChange={set("feeTo")} /><button className="btn" disabled={!/^0x[0-9a-fA-F]{40}$/.test(f.feeTo)} onClick={call("Set fee recipient", "setFeeRecipient", [f.feeTo as Address])}>Set</button></div>
            <p className="note">Where every coin's platform share goes when anyone presses "push platform fees".</p>
          </div>
          <div className="panel">
            <div className="lbl" style={{ marginBottom: 10 }}>Recover stray tokens</div>
            <div className="split2">
              <input className="inp" placeholder="token address" value={f.asset} onChange={set("asset")} />
              <input className="inp" inputMode="decimal" placeholder="amount (whole units)" value={f.amount} onChange={set("amount")} />
            </div>
            <button className="btn ghost" style={{ marginTop: 10 }} disabled={!/^0x[0-9a-fA-F]{40}$/.test(f.asset) || !(Number(f.amount) > 0)} onClick={call("Recover token", "recoverERC20", [f.asset as Address, parseEther((f.amount || "0") as `${number}`)])}>Send to fee recipient</button>
            <p className="note">Only tokens sent to the factory by mistake. Launch liquidity sits in the PoolManager and has no withdraw path.</p>
          </div>
        </div>
      </section>

      <section className="sec">
        <div className="sec-h"><h2>Pair assets</h2><span className="lbl">{cfg ? "" : "…"}</span></div>
        <Quotes call={call} />
      </section>

      <section className="sec">
        <div className="sec-h"><h2>Coins</h2><span className="lbl">{tokens?.length ?? 0}</span></div>
        {!tokens ? <div className="skeleton" style={{ minHeight: 120 }} /> : (
          <div className="list">{tokens.map((t) => <CoinRow key={t.address} t={t} />)}</div>
        )}
      </section>
      <p className="small" style={{ marginTop: 16 }}><Link to="/" style={{ color: "var(--green)" }}>Back to the feed</Link></p>
    </main>
  );
}

function Quotes({ call }: { call: (label: string, fn: Fn, args?: unknown[]) => () => Promise<void> }) {
  const { data: quotes } = useQuotes();
  const [px, setPx] = useState<Record<string, string>>({});
  const [feed, setFeed] = useState<Record<string, string>>({});
  const [add, setAdd] = useState({ address: "", usd: "", feed: "" });
  if (!quotes) return <div className="skeleton" style={{ minHeight: 120 }} />;
  const usd8 = (v: string) => BigInt(Math.round(Number(v || "0") * 1e8));
  const zero = "0x0000000000000000000000000000000000000000";
  const row = (q: QuoteView) => (
    <div key={q.address} className="qrow">
      <div><b>{q.symbol}</b>{!q.approved && <span className="small"> · retired</span>}{q.ethRoute && !q.isNative && <span className="small up"> · ETH route</span>}</div>
      <div className="small">{q.name} · <Copy value={q.address} />{q.liqUsd > 0 ? ` · ${usd(q.liqUsd, { compact: true })} pool` : ""}</div>
      <div className="mono small">{usd(q.usd)}</div>
      <input className="inp" inputMode="decimal" placeholder="USD price" value={px[q.address] ?? ""} onChange={(e) => setPx({ ...px, [q.address]: e.target.value })} />
      <div className="row">
        <input className="inp" placeholder="feed 0x… (optional)" value={feed[q.address] ?? ""} onChange={(e) => setFeed({ ...feed, [q.address]: e.target.value })} style={{ width: 150 }} />
        <button className="btn" disabled={!(Number(px[q.address]) > 0) && !/^0x[0-9a-fA-F]{40}$/.test(feed[q.address] ?? "")} onClick={call(`Price ${q.symbol}`, "setQuoteAsset", [q.address, true, usd8(px[q.address] ?? "0"), (/^0x[0-9a-fA-F]{40}$/.test(feed[q.address] ?? "") ? feed[q.address] : zero) as Address])}>{q.approved ? "Set" : "Approve"}</button>
        {q.approved && !q.isNative && <button className="btn ghost" onClick={call(`Retire ${q.symbol}`, "setQuoteAsset", [q.address, false, 0n, zero as Address])}>Retire</button>}
      </div>
    </div>
  );
  return (
    <div className="panel">
      {quotes.map(row)}
      <div className="lbl" style={{ margin: "16px 0 8px" }}>Add a pair asset</div>
      <div className="split2">
        <input className="inp" placeholder="ERC20 address on Ethereum (18 decimals)" value={add.address} onChange={(e) => setAdd({ ...add, address: e.target.value })} />
        <input className="inp" inputMode="decimal" placeholder="USD per whole token" value={add.usd} onChange={(e) => setAdd({ ...add, usd: e.target.value })} />
      </div>
      <input className="inp" style={{ marginTop: 8 }} placeholder="Chainlink USD feed (optional)" value={add.feed} onChange={(e) => setAdd({ ...add, feed: e.target.value })} />
      <button className="btn" style={{ marginTop: 10 }} disabled={!/^0x[0-9a-fA-F]{40}$/.test(add.address) || (!(Number(add.usd) > 0) && !/^0x[0-9a-fA-F]{40}$/.test(add.feed))} onClick={call("Approve pair asset", "setQuoteAsset", [add.address as Address, true, usd8(add.usd), (/^0x[0-9a-fA-F]{40}$/.test(add.feed) ? add.feed : zero) as Address])}>Approve</button>
      <p className="note">A Chainlink feed, when set and fresh, overrides the USD price. The price sizes the $3k opening pool of every coin launched on that pair and every dollar figure shown for it. Retiring stops new launches; existing coins keep trading. ETH cannot be retired.</p>
    </div>
  );
}

function CoinRow({ t }: { t: Token }) {
  const qc = useQueryClient();
  return (
    <div className="li">
      <Art src={t.metadata?.logo} name={t.name} className="art" size={40} />
      <div><Link to={`/t/${t.address}`} style={{ color: "inherit", fontWeight: 600 }}>{t.name}</Link><div className="l2">{t.symbol} · pairs {t.pair.symbol}{isHidden(t.address) ? " · hidden" : ""} · <Copy value={t.address} /> · <a href={`${env.explorerUrl}/token/${t.address}`} target="_blank" rel="noreferrer">Etherscan</a></div></div>
      <div className="r">{usd(t.marketCapUsd, { compact: true })} cap<div className="l2">{t.rewards ? `paid out ${hype(wei(t.rewards.holders + t.rewards.creator + t.rewards.platform), 4)} ${t.pair.symbol}` : ""}</div></div>
      <button className="btn ghost" onClick={async () => { await ensureWallet(); await runTx("Push platform fees", () => client.claimPlatformFees(t.address), async () => { await qc.invalidateQueries(); }); }}>Push platform fees</button>
    </div>
  );
}
