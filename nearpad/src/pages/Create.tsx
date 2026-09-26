import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import { Art } from "../components/Art";
import { SplitBar } from "../components/SplitBar";
import { DEPLOYED, env, RULES } from "../lib/env";
import { toUnits, units } from "../lib/format";
import { setToast, useConfig, useCurrency, useNearUsd, usePairs } from "../lib/hooks";
import { view } from "../lib/rpc";
import type { CoinRow, Split } from "../lib/types";
import { pairDecimals, pairSymbol } from "../lib/types";
import { makeValuer } from "../lib/value";
import { openWalletModal, send, useAccount } from "../lib/wallet";

const PRESETS: { k: string; label: string; help: string; buy: number; sell: number; split: Split }[] = [
  { k: "creator", label: "Creator-backed", help: "3% each way. Half to you, half to holders.", buy: 3, sell: 3, split: { creator_bps: 5000, dividends_bps: 5000, burn_bps: 0, liquidity_bps: 0 } },
  { k: "diamond", label: "Diamond hands", help: "3% each way, all of it to holders.", buy: 3, sell: 3, split: { creator_bps: 0, dividends_bps: 10000, burn_bps: 0, liquidity_bps: 0 } },
  { k: "deflate", label: "Deflationary", help: "3% buy, 5% sell. Most of it buys the coin back and burns it.", buy: 3, sell: 5, split: { creator_bps: 2000, dividends_bps: 2000, burn_bps: 6000, liquidity_bps: 0 } },
  { k: "lp", label: "Auto-LP", help: "3% each way. Holders and the pool share it.", buy: 3, sell: 3, split: { creator_bps: 2000, dividends_bps: 4000, burn_bps: 0, liquidity_bps: 4000 } },
];

export default function Create() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { accountId } = useAccount();
  const { data: cfg } = useConfig();
  const { data: pairs } = usePairs();
  const { data: nearUsd = 0 } = useNearUsd();
  const [ccy] = useCurrency();
  const fileRef = useRef<HTMLInputElement>(null);
  const [f, setF] = useState({ name: "", symbol: "", description: "", website: "", x: "", telegram: "", feeWallet: "", initialBuy: "" });
  const [icon, setIcon] = useState("");
  const [pairKey, setPairKey] = useState("NEAR");
  const [preset, setPreset] = useState("diamond");
  const [buy, setBuy] = useState(3);
  const [sell, setSell] = useState(3);
  const [split, setSplit] = useState<Split>({ creator_bps: 0, dividends_bps: 10000, burn_bps: 0, liquidity_bps: 0 });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const render = (bmp: ImageBitmap, size: number, q: number) => {
    const c = document.createElement("canvas"); c.width = size; c.height = size;
    const ctx = c.getContext("2d")!; const side = Math.min(bmp.width, bmp.height);
    ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
    const w = c.toDataURL("image/webp", q); return w.startsWith("data:image/webp") ? w : c.toDataURL("image/jpeg", q);
  };
  const onFile = async (file: File) => {
    try {
      const bmp = await createImageBitmap(file);
      let out = render(bmp, 128, 0.72);
      if (out.length > 12_000) out = render(bmp, 96, 0.62);
      if (out.length > 12_000) out = render(bmp, 72, 0.6);
      setIcon(out);
    } catch { setToast({ kind: "err", text: "Could not read that image. Try a PNG or JPG." }); }
  };

  const symbol = (f.symbol || f.name).replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 10) || "COIN";
  const pair = (pairs ?? []).find((p) => p.key === pairKey) ?? pairs?.[0];
  const near = !pair || pair.asset === "Near";
  const psym = pair ? pairSymbol(pair.asset) : "NEAR";
  const pdec = pair ? pairDecimals(pair.asset) : 24;
  const val = useMemo(() => makeValuer(ccy, nearUsd), [ccy, nearUsd]);
  const graduation = pair ? (BigInt(pair.virtual_reserve) * 2n).toString() : "0";
  const sum = split.creator_bps + split.dividends_bps + split.burn_bps + split.liquidity_bps;
  const ok = sum === 10000;
  const launchFee = BigInt(cfg?.launch_fee ?? "500000000000000000000000");
  const stateDeposit = BigInt(cfg?.coin_state_deposit ?? "500000000000000000000000");
  const initial = near ? toUnits(f.initialBuy, 24) : 0n;
  const total = launchFee + stateDeposit + initial + (near ? 0n : 12_500_000_000_000_000_000_000n);

  const applyPreset = (k: string) => {
    const p = PRESETS.find((x) => x.k === k);
    if (!p) return;
    setPreset(k); setBuy(p.buy); setSell(p.sell); setSplit(p.split);
  };
  const setShare = (k: keyof Split, v: number) => { setPreset("custom"); setSplit({ ...split, [k]: v * 100 }); };
  const even = () => { setPreset("custom"); setSplit({ creator_bps: 2500, dividends_bps: 2500, burn_bps: 2500, liquidity_bps: 2500 }); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountId) return openWalletModal();
    if (!pair || !ok) return;
    setBusy(true);
    try {
      const url = (s: string, host: string) => (s.trim() ? (/^https?:/i.test(s.trim()) ? s.trim() : `https://${host}${s.trim().replace(/^@/, "")}`) : null);
      const params = {
        name: f.name.trim(), symbol, icon: icon || null, description: f.description.trim(),
        links: { website: f.website.trim() ? (/^https?:/i.test(f.website.trim()) ? f.website.trim() : `https://${f.website.trim()}`) : null, x: url(f.x, "x.com/"), telegram: url(f.telegram, "t.me/") },
        pair: pair.key, buy_tax_bps: buy * 100, sell_tax_bps: sell * 100, split,
        fee_wallet: f.feeWallet.trim() || null, initial_buy: initial > 0n ? initial.toString() : null,
      };
      const before = cfg?.count ?? 0;
      const done = await send(`Create ${symbol}`, [{ receiverId: env.factory, methodName: "create", args: { params }, deposit: total.toString(), gas: "300000000000000" }], async () => {
        await qc.invalidateQueries();
      });
      if (done) {
        const list = await view<CoinRow[]>(env.factory, "list", { limit: 5 }).catch(() => []);
        const mine = list.find((r) => r.creator === accountId && r.symbol === symbol) ?? list.find((r) => r.id > before);
        if (mine) nav(`/t/${mine.account_id}`); else nav("/");
      }
    } finally { setBusy(false); }
  };

  if (!DEPLOYED) return <main className="gate"><h1>Not live yet</h1><p>The factory is not on NEAR yet.</p><Link to="/" className="b">Back to coins</Link></main>;
  const cta = !accountId ? "Connect wallet" : busy ? "Creating…" : `Create ${symbol}`;
  const shares = [["creator_bps", "Creator", "Paid to the creator fee wallet."], ["dividends_bps", "Dividends", "Paid out to token holders."], ["burn_bps", "Buyback and burn", "Buys tokens from the pool and burns them."], ["liquidity_bps", "Liquidity", "Added to the pool as liquidity."]] as const;

  return (
    <main className="launch">
      <div className="launch-head">
        <h1>Create a coin</h1>
        <p className="sub">Name it, choose where the tax goes, and launch. Everything below is fixed at launch, so read it once.</p>
      </div>
      <div className="launch-grid">
      <form className="card" onSubmit={submit}>
        <div className="fs">
          <h3>Coin details<small>Fixed at launch. Choose carefully.</small></h3>
          <label className="drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const file = e.dataTransfer.files?.[0]; if (file) onFile(file); }}>
            {icon ? <img src={icon} alt="" /> : <div className="ph">+</div>}
            <div><div className="t">{icon ? "Image added" : "Token image"}</div><div className="help">PNG, JPG or WebP. Square, stored on chain, so it is kept small.{icon && <> · <a href="#" onClick={(e) => { e.preventDefault(); setIcon(""); }}>Remove</a></>}</div></div>
            <input ref={fileRef} type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (file) onFile(file); }} />
          </label>
          <div className="f2">
            <div className="f"><label>Name</label><input className="in" value={f.name} onChange={set("name")} placeholder="Moon Cat" minLength={2} maxLength={32} required /><div className="help">2 to 32 characters.</div></div>
            <div className="f"><label>Ticker</label><input className="in" value={f.symbol} onChange={set("symbol")} placeholder={symbol} maxLength={10} style={{ textTransform: "uppercase" }} /><div className="help">2 to 10 letters or digits.</div></div>
          </div>
          <div className="f"><label>Description</label><textarea className="in" value={f.description} onChange={set("description")} placeholder="A short description of the token" maxLength={280} /><div className="help">Optional. {f.description.length}/280</div></div>
          <div className="f2">
            <div className="f"><label>Website</label><input className="in" value={f.website} onChange={set("website")} placeholder="example.com" /></div>
            <div className="f"><label>X</label><input className="in" value={f.x} onChange={set("x")} placeholder="@handle" /></div>
          </div>
          <div className="f"><label>Telegram</label><input className="in" value={f.telegram} onChange={set("telegram")} placeholder="@group" /></div>
        </div>

        <div className="fs">
          <h3>Pair with<small>What people buy your token with. Fixed at launch.</small></h3>
          <div className="pairs-row">
            {(pairs ?? []).filter((p) => p.enabled).map((p) => <button type="button" key={p.key} className={pairKey === p.key ? "on" : ""} onClick={() => setPairKey(p.key)}><span className="av">{p.key.slice(0, 2).toUpperCase()}</span>{p.name}</button>)}
          </div>
          <div className="help">{near ? "People buy your token with NEAR, and holder dividends are paid in NEAR. Buyers pay straight from their wallet." : `People buy your token with ${psym}, and holder dividends are paid in ${psym}. Buyers need ${psym} in their wallet.`} Graduates at {pair ? val(pair.asset).fmt(graduation) : "—"} raised.</div>
        </div>

        <div className="fs">
          <h3>Where the tax goes<small>The platform keeps 20% of the tax. The split below is the other 80%.</small></h3>
          <div className="taxform">
            <div className="presets">
              {PRESETS.map((p) => <button type="button" key={p.k} className={preset === p.k ? "on" : ""} onClick={() => applyPreset(p.k)}>{p.label}</button>)}
              <button type="button" className={preset === "custom" ? "on" : ""} onClick={() => setPreset("custom")}>Custom</button>
            </div>
            <div className="help">{PRESETS.find((p) => p.k === preset)?.help ?? "Your own tax and split."}</div>
            <div className="sliders">
              <label><span>Buy tax</span><input type="range" min={RULES.minTaxPct} max={RULES.maxTaxPct} value={buy} onChange={(e) => { setPreset("custom"); setBuy(Number(e.target.value)); }} /><span className="val">{buy}%</span></label>
              <label><span>Sell tax</span><input type="range" min={RULES.minTaxPct} max={RULES.maxTaxPct} value={sell} onChange={(e) => { setPreset("custom"); setSell(Number(e.target.value)); }} /><span className="val">{sell}%</span></label>
              {shares.map(([k, label]) => (
                <label key={k}><span>{label}</span><input type="range" min={0} max={100} step={5} value={split[k] / 100} onChange={(e) => setShare(k, Number(e.target.value))} /><span className={"val " + (ok ? "" : "bad")}>{split[k] / 100}%</span></label>
              ))}
            </div>
            <div className="row-flex" style={{ alignItems: "center", gap: 10 }}>
              <span className={"help " + (ok ? "" : "down")} style={{ margin: 0 }}>Totals {sum / 100}%{ok ? "" : ", must be 100%"}</span>
              <button type="button" className="b ghost sm" onClick={even}>Split evenly</button>
            </div>
            <SplitBar split={split} compact />
          </div>
        </div>

        <div className="fs">
          <h3>Initial buy<small>Optional. The first trade on your token, before anyone else can buy.</small></h3>
          <div className="f">
            <label>Amount in NEAR</label>
            <input className="in" inputMode="decimal" value={f.initialBuy} onChange={set("initialBuy")} placeholder="0" disabled={!near} />
            <div className="help">{near ? `Bought in the same transaction at the ${buy}% tax.` : `Not available on a ${psym} coin. Buy on the coin page right after launch.`}</div>
          </div>
          <div className="f">
            <label>Creator fee wallet</label>
            <input className="in" value={f.feeWallet} onChange={set("feeWallet")} placeholder={accountId ?? "you.near"} />
            <div className="help">Credited in {psym}. Defaults to your wallet. Only the platform can reassign it, to a community lead on request.</div>
          </div>
        </div>

        <div className="fs summary">
          <h3>Review and launch</h3>
          <dl className="kv">
            <dt>Launch fee</dt><dd>{units(launchFee.toString(), 24)} NEAR</dd>
            <dt>Coin account</dt><dd>{units(stateDeposit.toString(), 24)} NEAR<span className="dim">stays with the coin for its storage</span></dd>
            {!near && <><dt>Pair registration</dt><dd>0.0125 NEAR</dd></>}
            {initial > 0n && <><dt>Initial buy</dt><dd>{units(initial.toString(), 24)} NEAR</dd></>}
            <dt>Total</dt><dd><b>{units(total.toString(), 24)} NEAR</b>{nearUsd > 0 ? <span className="dim">about ${(units(total.toString(), 24) * nearUsd).toFixed(2)}</span> : null}</dd>
          </dl>
          <button className="b pri lg wide" type="submit" disabled={busy || !f.name.trim() || !ok} style={{ marginTop: 16 }}>{cta}</button>
        </div>
      </form>

      <aside className="preview">
        <div className={"coincard " + (near ? "eth" : "stock")}>
          <div className="cc-top">
            <Art src={icon} name={f.name || "Your coin"} className="art" size={64} />
            <span className={"chip " + (near ? "eth" : "stock")}>{psym}</span>
          </div>
          <div className="cc-name display">{f.name || "Your coin"}</div>
          <div className="cc-sym">{symbol}</div>
          <div className="cc-pays">Pays holders in <b>{psym}</b></div>
          <SplitBar split={split} compact />
          <dl className="cc-kv">
            <dt>Opens at</dt><dd>{pair ? val(pair.asset).fmt((BigInt(pair.virtual_reserve) * 8n / 9n).toString(), true) : "—"} cap</dd>
            <dt>Graduates at</dt><dd>{pair ? val(pair.asset).fmt(graduation, true) : "—"} raised</dd>
            <dt>Tax</dt><dd>{buy}% / {sell}%</dd>
            <dt>Supply</dt><dd>1B, fixed</dd>
            <dt>Pool</dt><dd>Opens at graduation</dd>
          </dl>
          {f.description.trim() && <p className="cc-desc">{f.description.trim()}</p>}
        </div>
        <p className="note">Locked once the token is live: the name, ticker and image, the buy and sell tax, the four-way split, the pair. The creator fee wallet can only be reassigned by the platform on request. {pdec === 24 ? "" : ""}</p>
      </aside>
      </div>
    </main>
  );
}
