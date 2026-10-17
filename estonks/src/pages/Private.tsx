import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { formatEther, isAddress, parseEther, type Address } from "viem";
import { useAccount } from "wagmi";

import { Art } from "../components/Art";
import { Copy } from "../components/Copy";
import { Icon } from "../components/Icon";
import { hype, num, usd, wei } from "../lib/format";
import { runTx, setToast, useBalances, useEthUsd, useTokens, type Token } from "../lib/hooks";
import { ETH } from "../lib/private/core";
import { priv, usePrivate } from "../lib/private/session";
import { ensureWallet, openWalletModal } from "../lib/wallet";

type Tab = "shield" | "unshield" | "send";
const amountOf = (v: string) => { try { return v && Number(v) > 0 ? parseEther(v as `${number}`) : 0n; } catch { return 0n; } };

/** Private wallet: create or unlock it, see private balances, shield, unshield and send. */
export default function Private() {
  const s = usePrivate();
  return (
    <main className="pv">
      <div style={{ paddingTop: 14 }}>
        <h1>Private.</h1>
        <p className="lede">Hold and trade Estonks coins without linking them to your wallet.</p>
      </div>
      {!s.live ? <Soon /> : !s.unlocked ? <Gate exists={s.exists} /> : <Wallet />}
      <Explainer />
    </main>
  );
}

function Soon() {
  return <div className="card pv-card"><h3>Coming soon</h3><p className="note" style={{ margin: 0 }}>Private balances and private trading go live once the vault is deployed. <Link to="/docs">How it works</Link></p></div>;
}

/** Create, unlock or restore the private wallet kept in this browser. */
function Gate({ exists }: { exists: boolean }) {
  const [mode, setMode] = useState<"unlock" | "create" | "restore">(exists ? "unlock" : "create");
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [phrase, setPhrase] = useState("");
  const [shown, setShown] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const go = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); } catch (e: any) { setToast({ kind: "err", text: e.message }); } finally { setBusy(false); } };

  if (shown) return (
    <div className="card pv-card">
      <h3>Your recovery phrase</h3>
      <p className="note" style={{ margin: 0 }}>These 24 words are the only way to recover your private balance on another device or if this browser's data is cleared. Write them down and keep them offline. Anyone with them can spend your private balance.</p>
      <ol className="pv-words">{shown.split(" ").map((w, i) => <li key={i}><i>{i + 1}</i>{w}</li>)}</ol>
      <label className="pv-check"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />I wrote down all 24 words.</label>
      <button className="btn pri wide" disabled={!saved} onClick={() => { priv.start(shown); setShown(null); }}>Continue</button>
    </div>
  );

  return (
    <div className="card pv-card">
      <div className="segs pv-seg">
        {exists && <button className={mode === "unlock" ? "on" : ""} onClick={() => setMode("unlock")}>Unlock</button>}
        <button className={mode === "create" ? "on" : ""} onClick={() => setMode("create")}>{exists ? "New wallet" : "Create"}</button>
        <button className={mode === "restore" ? "on" : ""} onClick={() => setMode("restore")}>Restore</button>
      </div>
      {mode === "unlock" && <>
        <p className="note" style={{ margin: 0 }}>Your private wallet is saved in this browser, locked with your passphrase.</p>
        <label className="lf-f"><span>Passphrase</span><input type="password" value={pass} onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && pass) void go(() => priv.unlock(pass)); }} autoComplete="current-password" /></label>
        <button className="btn pri wide" disabled={busy || !pass} onClick={() => go(() => priv.unlock(pass))}>{busy ? "Unlocking…" : "Unlock"}</button>
      </>}
      {mode === "create" && <>
        <p className="note" style={{ margin: 0 }}>A private wallet is separate from your normal wallet. It lives in this browser, locked with a passphrase, and locks itself after 15 idle minutes.{exists ? " Creating a new one replaces the one saved here; keep its recovery phrase if it holds anything." : ""}</p>
        <label className="lf-f"><span>Passphrase</span><input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" placeholder="At least 8 characters" /></label>
        <label className="lf-f"><span>Repeat</span><input type="password" value={pass2} onChange={(e) => setPass2(e.target.value)} autoComplete="new-password" /></label>
        <button className="btn pri wide" disabled={busy || pass.length < 8 || pass !== pass2} onClick={() => go(async () => setShown(await priv.create(pass)))}>{pass && pass2 && pass !== pass2 ? "Passphrases differ" : busy ? "Creating…" : "Create private wallet"}</button>
      </>}
      {mode === "restore" && <>
        <label className="lf-f"><span>Phrase</span><textarea rows={3} value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder="24 words" spellCheck={false} /></label>
        <label className="lf-f"><span>Passphrase</span><input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" placeholder="New passphrase for this browser" /></label>
        <button className="btn pri wide" disabled={busy || pass.length < 8 || phrase.trim().split(/\s+/).length !== 24} onClick={() => go(() => priv.restore(phrase, pass))}>{busy ? "Restoring…" : "Restore"}</button>
      </>}
    </div>
  );
}

function Wallet() {
  const s = usePrivate();
  const { data: tokens } = useTokens();
  const { data: ethUsd = 0 } = useEthUsd();
  const [tab, setTab] = useState<Tab>("shield");
  const byAddr = useMemo(() => new Map((tokens ?? []).map((t) => [t.address.toLowerCase(), t])), [tokens]);
  const rows = [...s.balances.entries()].filter(([, v]) => v > 0n).sort(([a], [b]) => (a === ETH ? -1 : b === ETH ? 1 : 0));
  const valueOf = (asset: string, v: bigint) => (asset === ETH ? wei(v) * ethUsd : wei(v) * Number(byAddr.get(asset)?.priceUsd ?? 0));
  const total = rows.reduce((sum, [a, v]) => sum + valueOf(a, v), 0);

  return (
    <>
      <section className="hero pv-hero">
        <div className="head">
          <div><span className="label">Private balance</span><div className="big">{usd(total)}</div><div className="sub">{s.syncing ? "Syncing with the vault…" : `${rows.length} ${rows.length === 1 ? "asset" : "assets"}`}</div></div>
          <div className="rowb"><button className="btn dim sm" onClick={() => priv.refresh()} disabled={s.syncing}>Refresh</button><button className="btn dim sm" onClick={() => priv.lock()}>Lock</button></div>
        </div>
        <div className="pv-addr"><span className="label">Your private address</span><Copy value={s.address!} label={`${s.address!.slice(0, 10)}…${s.address!.slice(-6)}`} /></div>
      </section>

      <div className="list" style={{ marginTop: 10 }}>
        {rows.length === 0 && <div className="empty">Nothing here yet. Shield ETH to start.</div>}
        {rows.map(([a, v]) => { const t = byAddr.get(a); return (
          <div key={a} className="item">
            {a === ETH ? <span className="pv-eth">Ξ</span> : <Art src={t?.metadata?.logo} address={a as Address} size="sm" />}
            <span><b>{a === ETH ? "ETH" : t?.symbol ?? `${a.slice(0, 8)}…`}</b><small className="num">{a === ETH ? hype(wei(v), 5) : num(wei(v))}</small></span>
            <span className="amt">{usd(valueOf(a, v))}{t && <><br /><Link to={`/t/${a}`}><small>Trade</small></Link></>}</span>
          </div>); })}
      </div>

      {s.step && <p className="note pv-step"><Icon name="private" size={14} /> {s.step}. Proofs are made on this device and take 10 to 30 seconds.</p>}

      <div className="card pv-card" style={{ marginTop: 12 }}>
        <div className="segs pv-seg">{(["shield", "unshield", "send"] as Tab[]).map((k) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{k === "shield" ? "Shield" : k === "unshield" ? "Unshield" : "Send"}</button>)}</div>
        {tab === "shield" ? <Shield tokens={tokens ?? []} /> : <Move tab={tab} rows={rows} byAddr={byAddr} />}
      </div>
    </>
  );
}

/** Deposit from the connected public wallet. */
function Shield({ tokens }: { tokens: Token[] }) {
  const { address: me, isConnected } = useAccount();
  const qc = useQueryClient();
  const [asset, setAsset] = useState<string>(ETH);
  const [amt, setAmt] = useState("");
  const { data: bal } = useBalances(me, asset === ETH ? undefined : (asset as Address));
  const have = asset === ETH ? bal?.native ?? 0n : bal?.token ?? 0n;
  const amount = amountOf(amt);
  const go = async () => {
    if (!isConnected) return openWalletModal();
    await ensureWallet();
    const ok = await runTx("Shield", () => priv.shield(asset as Address, amount), async () => { await priv.refresh(); await qc.invalidateQueries({ queryKey: ["bal"] }); });
    if (ok) setAmt("");
  };
  return (
    <div className="pv-form">
      <p className="note" style={{ margin: 0 }}>Moves funds from your connected wallet into your private balance. The deposit itself is public: your address, the asset and the amount.</p>
      <label className="lf-f"><span>Asset</span><select value={asset} onChange={(e) => { setAsset(e.target.value); setAmt(""); }}><option value={ETH}>ETH</option>{tokens.filter((t) => !t.hidden).map((t) => <option key={t.address} value={t.address.toLowerCase()}>{t.symbol}</option>)}</select></label>
      <label className="lf-f"><span>Amount</span><input inputMode="decimal" placeholder="0" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} /></label>
      <div className="pv-bal"><span>In your wallet: <b>{bal ? (asset === ETH ? hype(wei(have), 5) : num(wei(have))) : "…"}</b></span>{have > 0n && <button onClick={() => setAmt(formatEther(asset === ETH ? (have > parseEther("0.005") ? have - parseEther("0.005") : 0n) : have))}>Max</button>}</div>
      <p className="note" style={{ margin: 0 }}>Round amounts are harder to trace later than exact ones.</p>
      <button className="btn pri wide" disabled={isConnected && (amount === 0n || amount > have)} onClick={go}>{!isConnected ? "Connect wallet" : amount > have ? "Not enough" : "Shield"}</button>
    </div>
  );
}

/** Withdraw to a public address, or send to another private wallet. */
function Move({ tab, rows, byAddr }: { tab: Tab; rows: [string, bigint][]; byAddr: Map<string, Token> }) {
  const [asset, setAsset] = useState<string>(rows[0]?.[0] ?? ETH);
  const [amt, setAmt] = useState("");
  const [to, setTo] = useState("");
  const have = rows.find(([a]) => a === asset)?.[1] ?? 0n;
  const amount = amountOf(amt);
  const sym = (a: string) => (a === ETH ? "ETH" : byAddr.get(a)?.symbol ?? a.slice(0, 8));
  const validTo = tab === "unshield" ? isAddress(to) : /^ep1[0-9a-f]{128}$/i.test(to.trim());
  const go = async () => {
    const ok = await runTx(tab === "unshield" ? "Unshield" : "Private send", () => (tab === "unshield" ? priv.withdraw(asset as Address, amount, to as Address) : priv.send(asset as Address, amount, to.trim())), undefined, "Proving on this device");
    if (ok) { setAmt(""); setTo(""); }
  };
  if (rows.length === 0) return <p className="note" style={{ margin: 0 }}>Nothing to {tab === "unshield" ? "unshield" : "send"} yet.</p>;
  return (
    <div className="pv-form">
      <p className="note" style={{ margin: 0 }}>{tab === "unshield" ? "Sends from your private balance to any address. A brand-new wallet can't be linked to you. The relay pays the gas; its fee comes out of the amount." : "Sends to another private wallet. Nothing about it is public except that the vault was used."}</p>
      <label className="lf-f"><span>Asset</span><select value={asset} onChange={(e) => { setAsset(e.target.value); setAmt(""); }}>{rows.map(([a]) => <option key={a} value={a}>{sym(a)}</option>)}</select></label>
      <label className="lf-f"><span>Amount</span><input inputMode="decimal" placeholder="0" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} /></label>
      <div className="pv-bal"><span>Private: <b>{asset === ETH ? hype(wei(have), 5) : num(wei(have))} {sym(asset)}</b></span><button onClick={() => setAmt(formatEther(have))}>Max</button></div>
      <label className="lf-f"><span>To</span><input value={to} onChange={(e) => setTo(e.target.value)} placeholder={tab === "unshield" ? "0x… a fresh address is most private" : "ep1…"} spellCheck={false} /></label>
      <button className="btn pri wide" disabled={amount === 0n || amount > have || !validTo} onClick={go}>{amount > have ? "Not enough" : to && !validTo ? "Check the address" : tab === "unshield" ? "Unshield" : "Send privately"}</button>
    </div>
  );
}

function Explainer() {
  return (
    <section className="card pv-card" style={{ marginTop: 14 }}>
      <h3>What stays private</h3>
      <div className="kv"><span>Which deposit paid for which trade or withdrawal</span><b className="up">Private</b></div>
      <div className="kv"><span>Who owns what inside the vault</span><b className="up">Private</b></div>
      <div className="kv"><span>Deposits: address, asset, amount</span><b className="down">Public</b></div>
      <div className="kv"><span>Private trades: coin, size, price, time (the vault is the trader)</span><b className="down">Public</b></div>
      <div className="kv"><span>Withdrawals: address, asset, amount</span><b className="down">Public</b></div>
      <p className="note" style={{ margin: 0 }}>Exact amounts and quick timing can link a deposit to a withdrawal, so wait a while and use round amounts. The relay sees your IP address when you submit. Coins held privately don't earn holder rewards; their share goes to STONK holders. Private trades pay a 0.5% fee plus the relay's gas.</p>
    </section>
  );
}
