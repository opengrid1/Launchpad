import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import { Art } from "../components/Art";
import { PairLogo } from "../components/PairLogo";
import { SplitBar } from "../components/SplitBar";
import { DEPLOYED, env, RULES } from "../lib/env";
import { toUnits, units } from "../lib/format";
import { setToast, useConfig, useCurrency, useNearUsd, usePairs } from "../lib/hooks";
import { view } from "../lib/rpc";
import type { CoinRow, Split } from "../lib/types";
import { pairSymbol } from "../lib/types";
import { makeValuer, pairKind } from "../lib/value";
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
  const [pairTab, setPairTab] = useState<"near" | "stock" | "token">("near");
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
  const live = (pairs ?? []).filter((p) => p.enabled);
  const stocks = live.filter((p) => p.asset !== "Near" && pairKind(p.asset) === "stock");
  const tokens = live.filter((p) => p.asset !== "Near" && pairKind(p.asset) === "token");
  const pickTab = (t: typeof pairTab) => {
    setPairTab(t);
    if (t === "near") setPairKey("NEAR");
    else { const group = t === "stock" ? stocks : tokens; if (!group.some((p) => p.key === pairKey)) setPairKey(group[0]?.key ?? "NEAR"); }
  };
  const near = !pair || pair.asset === "Near";
  const psym = pair ? pairSymbol(pair.asset) : "NEAR";
  const val = useMemo(() => makeValuer(ccy, nearUsd), [ccy, nearUsd]);
  const graduation = pair ? (BigInt(pair.virtual_reserve) * 2n).toString() : "0";
  const sum = split.creator_bps + split.dividends_bps + split.burn_bps + split.liquidity_bps;
  const ok = sum === 10000;
  const launchFee = BigInt(cfg?.launch_fee ?? "500000000000000000000000");
  const stateDeposit = BigInt(cfg?.coin_state_deposit ?? "500000000000000000000000");
  const initial = near ? toUnits(f.initialBuy, 24) : 0n;
  const total = launchFee + stateDeposit + initial + (near ? 0n : 12_500_000_000_000_000_000_000n);

  const applyPreset = (k: string) => { const p = PRESETS.find((x) => x.k === k); if (!p) return; setPreset(k); setBuy(p.buy); setSell(p.sell); setSplit(p.split); };
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
      const done = await send(`Create ${symbol}`, [{ receiverId: env.factory, methodName: "create", args: { params }, deposit: total.toString(), gas: "300000000000000" }], async () => { await qc.invalidateQueries(); });
      if (done) {
        const list = await view<CoinRow[]>(env.factory, "list", { limit: 5 }).catch(() => []);
        const mine = list.find((r) => r.creator === accountId && r.symbol === symbol) ?? list.find((r) => r.id > before);
        nav(mine ? `/t/${mine.account_id}` : "/");
      }
    } finally { setBusy(false); }
  };

  if (!DEPLOYED) return <main className="gate"><h1>Not live yet</h1><p>The factory is not on NEAR yet.</p><Link to="/" className="b">Back to coins</Link></main>;
  const cta = !accountId ? "Connect wallet" : busy ? "Creating…" : `Create ${symbol} · ${units(total.toString(), 24)} NEAR`;
  const shares = [["creator_bps", "Creator"], ["dividends_bps", "Dividends"], ["burn_bps", "Buyback, burn"], ["liquidity_bps", "Liquidity"]] as const;

  return (
    <main className="create">
      <form className="steps" onSubmit={submit}>
        <div>
          <h1 style={{ fontSize: 22 }}>Create a coin</h1>
          <p className="fine" style={{ marginTop: 4 }}>Name it, choose where the tax goes, and launch. Everything below is fixed at launch.</p>
        </div>

        <section className="step">
          <h3><i>1</i>The coin<small>fixed at launch</small></h3>
          <label className="drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const file = e.dataTransfer.files?.[0]; if (file) onFile(file); }}>
            {icon ? <img src={icon} alt="" /> : <div className="ph">+</div>}
            <div><div className="t">{icon ? "Image added" : "Add an image"}</div><div className="fine">PNG, JPG or WebP, square. Stored on chain, so it is kept small.{icon && <> · <a href="#" onClick={(e) => { e.preventDefault(); setIcon(""); }}>Remove</a></>}</div></div>
            <input ref={fileRef} type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (file) onFile(file); }} />
          </label>
          <div className="f2">
            <div className="f"><label>Name</label><input className="in" value={f.name} onChange={set("name")} placeholder="Moon Cat" minLength={2} maxLength={32} required /></div>
            <div className="f"><label>Ticker</label><input className="in" value={f.symbol} onChange={set("symbol")} placeholder={symbol} maxLength={10} style={{ textTransform: "uppercase" }} /></div>
          </div>
          <div className="f"><label>Description <span className="faint" style={{ fontWeight: 500 }}>optional · {f.description.length}/280</span></label><textarea className="in" value={f.description} onChange={set("description")} placeholder="What is this coin about?" maxLength={280} /></div>
          <div className="f2">
            <div className="f"><label>Website</label><input className="in" value={f.website} onChange={set("website")} placeholder="example.com" /></div>
            <div className="f"><label>X</label><input className="in" value={f.x} onChange={set("x")} placeholder="@handle" /></div>
          </div>
          <div className="f"><label>Telegram</label><input className="in" value={f.telegram} onChange={set("telegram")} placeholder="@group" /></div>
        </section>

        <section className="step">
          <h3><i>2</i>Pair with<small>what people buy it with</small></h3>
          <div className="seg pairtabs">
            <button type="button" className={pairTab === "near" ? "on" : ""} onClick={() => pickTab("near")}><PairLogo k="NEAR" size={18} />NEAR</button>
            {stocks.length > 0 && <button type="button" className={pairTab === "stock" ? "on" : ""} onClick={() => pickTab("stock")}>Stocks<em>{stocks.length}</em></button>}
            {tokens.length > 0 && <button type="button" className={pairTab === "token" ? "on" : ""} onClick={() => pickTab("token")}>Tokens<em>{tokens.length}</em></button>}
          </div>
          {pairTab === "near" ? (
            <div className="pcell on solo">
              <PairLogo k="NEAR" size={40} />
              <div className="txt"><b>NEAR</b><small>The native coin. Buyers pay straight from their wallet, holders are paid in NEAR.</small></div>
              <span className="tick" aria-hidden>✓</span>
            </div>
          ) : (
            <div className="pairgrid">
              {(pairTab === "stock" ? stocks : tokens).map((p) => (
                <button type="button" key={p.key} className={"pcell " + (pairKey === p.key ? "on" : "")} onClick={() => setPairKey(p.key)} aria-pressed={pairKey === p.key}>
                  <PairLogo k={p.key} size={32} />
                  <div className="txt"><b>{p.key}</b><small>{p.name.replace(/ \(Ondo\)$/, "")}</small></div>
                  {pairKey === p.key && <span className="tick" aria-hidden>✓</span>}
                </button>
              ))}
            </div>
          )}
          <div className="pairsum">
            <PairLogo k={pair?.key ?? "NEAR"} size={28} />
            <div>
              <b>{near ? "Priced and paid in NEAR" : `Priced and paid in ${psym}`}</b>
              <small>{near ? "Anyone with NEAR can buy." : <>Buyers need {psym} in their wallet, <Link to={`/get/${pair?.key}`} className="vi">swapped from NEAR here</Link>. {pair?.name.replace(/ \(Ondo\)$/, "")} tokenized by Ondo.</>} Graduates at {pair ? val(pair.asset).fmt(graduation) : "—"} raised.</small>
            </div>
          </div>
        </section>

        <section className="step">
          <h3><i>3</i>Where the tax goes<small>platform keeps 20%, you divide the rest</small></h3>
          <div className="presets">
            {PRESETS.map((p) => <button type="button" key={p.k} className={preset === p.k ? "on" : ""} onClick={() => applyPreset(p.k)}>{p.label}</button>)}
            <button type="button" className={preset === "custom" ? "on" : ""} onClick={() => setPreset("custom")}>Custom</button>
          </div>
          <p className="fine">{PRESETS.find((p) => p.k === preset)?.help ?? "Your own tax and split."}</p>
          <div className="sliders">
            <label><span>Buy tax</span><input type="range" min={RULES.minTaxPct} max={RULES.maxTaxPct} value={buy} onChange={(e) => { setPreset("custom"); setBuy(Number(e.target.value)); }} /><span className="val">{buy}%</span></label>
            <label><span>Sell tax</span><input type="range" min={RULES.minTaxPct} max={RULES.maxTaxPct} value={sell} onChange={(e) => { setPreset("custom"); setSell(Number(e.target.value)); }} /><span className="val">{sell}%</span></label>
            {shares.map(([k, label]) => (
              <label key={k}><span>{label}</span><input type="range" min={0} max={100} step={5} value={split[k] / 100} onChange={(e) => setShare(k, Number(e.target.value))} /><span className={"val " + (ok ? "" : "bad")}>{split[k] / 100}%</span></label>
            ))}
          </div>
          <div className="row-flex" style={{ justifyContent: "space-between" }}>
            <span className={"fine " + (ok ? "" : "down")}>Shares total {sum / 100}%{ok ? "" : ", must be 100%"}</span>
            <button type="button" className="b ghost sm" onClick={even}>Split evenly</button>
          </div>
          <SplitBar split={split} compact />
        </section>

        <section className="step">
          <h3><i>4</i>Launch<small>optional first buy and fee wallet</small></h3>
          <div className="f2">
            <div className="f"><label>Initial buy, NEAR</label><input className="in" inputMode="decimal" value={f.initialBuy} onChange={set("initialBuy")} placeholder="0" disabled={!near} /><div className="help">{near ? `The first trade, in the same transaction, at the ${buy}% tax.` : `Not available on a ${psym} coin.`}</div></div>
            <div className="f"><label>Creator fee wallet</label><input className="in" value={f.feeWallet} onChange={set("feeWallet")} placeholder={accountId ?? "you.near"} /><div className="help">Defaults to your wallet. Only the platform can reassign it.</div></div>
          </div>
          <dl className="kv">
            <dt>Launch fee</dt><dd>{units(launchFee.toString(), 24)} NEAR</dd>
            <dt>Coin account</dt><dd>{units(stateDeposit.toString(), 24)} NEAR<span className="dim">stays with the coin for its storage</span></dd>
            {!near && <><dt>Pair registration</dt><dd>0.0125 NEAR</dd></>}
            {initial > 0n && <><dt>Initial buy</dt><dd>{units(initial.toString(), 24)} NEAR</dd></>}
          </dl>
          <div className="total"><span>Total</span><b>{units(total.toString(), 24)} NEAR{nearUsd > 0 ? <span className="fine" style={{ marginLeft: 8 }}>≈ ${(units(total.toString(), 24) * nearUsd).toFixed(2)}</span> : null}</b></div>
        </section>

        <div className="sticky-cta"><button className="b pri lg wide" type="submit" disabled={busy || !f.name.trim() || !ok}>{cta}</button></div>
      </form>

      <aside className="preview">
        <div className="pcard">
          <div className="t"><Art src={icon} name={f.name || "Your coin"} className="art" size={52} /><div><b>{symbol}</b><small>{f.name || "Your coin"} · pays {psym}</small></div></div>
          <SplitBar split={split} compact />
          <dl className="kv">
            <dt>Opens at</dt><dd>{pair ? val(pair.asset).fmt((BigInt(pair.virtual_reserve) * 8n / 9n).toString(), true) : "—"} cap</dd>
            <dt>Graduates at</dt><dd>{pair ? val(pair.asset).fmt(graduation, true) : "—"} raised</dd>
            <dt>Tax</dt><dd>{buy}% / {sell}%</dd>
            <dt>Supply</dt><dd>1B, fixed</dd>
          </dl>
          {f.description.trim() && <p className="fine" style={{ color: "inherit", opacity: .75 }}>{f.description.trim()}</p>}
        </div>
        <p className="fine">Locked once live: name, ticker, image, pair, buy and sell tax, the four-way split. The fee wallet can only be reassigned by the platform on request.</p>
      </aside>
    </main>
  );
}
