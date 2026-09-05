import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { parseEther, type Address } from "viem";
import { useAccount } from "wagmi";

import { Art } from "../components/Art";
import { PairPicker } from "../components/PairPicker";
import { client } from "../lib/client";
import { DEPLOYED, FEES } from "../lib/env";
import { usd } from "../lib/format";
import { friendlyError, runTx, setToast, useEthUsd, useQuotes } from "../lib/hooks";
import { WETH } from "../lib/stocks";
import { ensureWallet, openWalletModal } from "../lib/wallet";

export default function Launch() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { isConnected, address: me } = useAccount();
  const { data: ethUsd = 0 } = useEthUsd();
  const { data: quotes } = useQuotes();
  const [pairAddr, setPairAddr] = useState<Address>(WETH);
  const fileRef = useRef<HTMLInputElement>(null);
  const [f, setF] = useState({ name: "", symbol: "", description: "", website: "", twitter: "", telegram: "", devBuy: "" });
  const [logo, setLogo] = useState("");
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
      // Metadata is stored on-chain; mainnet calldata is ~16 gas per byte, so keep art small.
      let out = render(bmp, 128, 0.7);
      if (out.length > 12_000) out = render(bmp, 96, 0.62);
      if (out.length > 12_000) out = render(bmp, 72, 0.6);
      setLogo(out);
    } catch { setToast({ kind: "err", text: "Could not read that image. Try a PNG or JPG." }); }
  };

  const symbol = (f.symbol || f.name).replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 10) || "COIN";
  const pairs = (quotes ?? []).filter((q) => q.approved);
  const pair = pairs.find((q) => q.address.toLowerCase() === pairAddr.toLowerCase()) ?? pairs.find((q) => q.isNative);
  const pairSym = pair?.symbol ?? "ETH";
  const canDevBuy = !pair || pair.ethRoute;
  const dev = Number(f.devBuy) > 0 ? f.devBuy.trim() : "";
  const startUsd = 3000;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConnected) return openWalletModal();
    if (!pair) return;
    setBusy(true);
    try {
      await ensureWallet();
      const meta: Record<string, string> = { description: f.description.trim() };
      if (f.website.trim()) meta.website = /^https?:/i.test(f.website.trim()) ? f.website.trim() : `https://${f.website.trim()}`;
      if (f.twitter.trim()) meta.twitter = /^https?:/i.test(f.twitter.trim()) ? f.twitter.trim() : `https://x.com/${f.twitter.trim().replace(/^@/, "")}`;
      if (f.telegram.trim()) meta.telegram = /^https?:/i.test(f.telegram.trim()) ? f.telegram.trim() : `https://t.me/${f.telegram.trim().replace(/^@/, "")}`;
      if (logo) meta.logo = logo;
      const devWei = dev ? parseEther(dev as `${number}`) : 0n;
      const p = { name: f.name.trim(), symbol, metadataURI: JSON.stringify(meta), pair: pair.address, devBuyWei: devWei };
      try { await client.estimateLaunch(p, me!); } catch (err) { setToast({ kind: "err", text: friendlyError(err) }); return; }
      let created: `0x${string}` | null = null;
      const ok = await runTx(`Launch ${symbol}`, () => client.createToken(p), async () => {
        const list = await client.getTokens({ limit: 5 });
        created = (list.find((t) => t.creator.toLowerCase() === me!.toLowerCase() && t.symbol === symbol)?.address ?? list[0]?.address ?? null) as `0x${string}` | null;
        await qc.invalidateQueries({ queryKey: ["tokens"] });
      });
      if (ok && created) nav(`/t/${created}`);
    } finally { setBusy(false); }
  };

  const cta = !isConnected ? "Connect wallet" : busy ? "Launching…" : `Launch ${symbol} now`;

  if (!DEPLOYED) return <main className="page"><section className="hero" style={{ gridTemplateColumns: "1fr" }}><div><h1>Not live <em>yet</em>.</h1><p className="sub">The factory is not on-chain yet.</p></div></section></main>;

  return (
    <main className="page">
      <section className="hero" style={{ gridTemplateColumns: "1fr", paddingBottom: 10 }}>
        <div>
          <div className="lbl" style={{ marginBottom: 12 }}>Launch a coin</div>
          <h1>Pair it with a <em>stock</em>.</h1>
          <p className="sub">One transaction on Ethereum. The whole supply goes into a locked Uniswap V4 pool at about {usd(startUsd, { compact: true })}, paired with ETH or any of {Math.max(0, pairs.length - 1)} tokenized stocks. Every trade pays {FEES.taxPct}%: {FEES.creatorPct}% to you, {FEES.holderPct}% to holders, {FEES.platformPct}% to the platform.</p>
        </div>
      </section>

      <div className="sign-m m-only">
        <Art src={logo} name={f.name || "Your coin"} className="av" size={48} />
        <div><b>{f.name || "Your coin"}</b><small className="mono">{symbol} · {usd(startUsd, { compact: true })} start · pairs {pairSym}</small></div>
        <span className="onair"><span className="dot" style={{ width: 6, height: 6, boxShadow: "none" }} />PREVIEW</span>
      </div>
      <div className="split">
        <form className="form" id="golive" onSubmit={submit}>
          <label className="drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const file = e.dataTransfer.files?.[0]; if (file) onFile(file); }}>
            {logo ? <img src={logo} alt="" /> : <div className="ph">+</div>}
            <div><div style={{ fontWeight: 500 }}>{logo ? "Artwork ready" : "Add artwork"}</div><div className="help">Square PNG or JPG. Stored on-chain with the coin, so it is kept small.{logo && <> · <a href="#" onClick={(e) => { e.preventDefault(); setLogo(""); }}>Remove</a></>}</div></div>
            <input ref={fileRef} type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (file) onFile(file); }} />
          </label>
          <div className="field"><label>Name</label><input value={f.name} onChange={set("name")} placeholder="Moon Cat" maxLength={40} required /></div>
          <div className="field"><label>Ticker</label><input value={f.symbol} onChange={set("symbol")} placeholder={symbol} maxLength={10} style={{ textTransform: "uppercase" }} /><div className="help">Up to 10 characters. Leave blank to derive from the name.</div></div>
          <div className="field"><label>Description</label><textarea value={f.description} onChange={set("description")} placeholder="What is this coin about?" maxLength={400} /></div>
          <div className="split2">
            <div className="field"><label>Website</label><input value={f.website} onChange={set("website")} placeholder="example.com" /></div>
            <div className="field"><label>X</label><input value={f.twitter} onChange={set("twitter")} placeholder="@handle" /></div>
          </div>
          <div className="field"><label>Telegram</label><input value={f.telegram} onChange={set("telegram")} placeholder="@group" /></div>
          <div className="field">
            <label>Pair · ETH or {Math.max(0, pairs.length - 1)} stocks</label>
            <PairPicker
              pairs={pairs}
              value={pair?.address ?? WETH}
              onChange={(a) => { setPairAddr(a); setF({ ...f, devBuy: "" }); }}
              note={!pair || pair.isNative
                ? "The pool holds ETH on the other side. Buyers pay ETH and your fees come in ETH."
                : pair.ethRoute
                  ? `The pool holds ${pairSym} on the other side. Buyers still pay plain ETH; the router swaps through ${pairSym}'s pool on the way. Your fees arrive in ${pairSym}, claimable as ETH.`
                  : `${pairSym} has no on-chain pool right now, so buyers must already hold ${pairSym} to trade this coin, and no ETH first buy is possible. Pick a stock marked "tradeable in ETH" for the easiest launch.`}
            />
          </div>
          <div className="field">
            <label>First buy (optional)</label>
            <input inputMode="decimal" value={f.devBuy} onChange={set("devBuy")} placeholder="0" disabled={!canDevBuy} />
            <div className="help">{canDevBuy ? `ETH spent in the same transaction, so you hold from the first block at the base ${FEES.taxPct}% fee. Everyone can see it.` : "Not available for a pair without an ETH route."}{dev && ethUsd > 0 && <> · ≈ {usd(Number(dev) * ethUsd)}</>}</div>
          </div>
          <button className="big sell d-only" type="submit" disabled={busy || !f.name.trim()}>{cta}</button>
          <p className="note">Free apart from Ethereum gas, usually under a dollar. For the first 20 seconds after launch the fee starts at 99% and decays to {FEES.taxPct}%, and each wallet is capped at 3% of supply for three blocks, so bots cannot take the top. Your own first buy is exempt.</p>
        </form>

        <aside className="sign d-only">
          <div className="onair"><span className="dot" style={{ width: 7, height: 7, boxShadow: "none" }} />PREVIEW</div>
          <Art src={logo} name={f.name || "Your coin"} className="art" />
          <h3>{f.name || "Your coin"}</h3>
          <div className="small mono">{symbol} · {usd(startUsd, { compact: true })} · just now</div>
          <div>
            <dl className="specs">
              <dt>Supply</dt><dd>1,000,000,000</dd>
              <dt>Starting market cap</dt><dd>≈ {usd(startUsd, { compact: true })}</dd>
              <dt>Pair</dt><dd>{pairSym}</dd>
              <dt>Trade fee</dt><dd>{FEES.taxPct}%</dd>
              <dt>Your share of fees</dt><dd>{FEES.creatorPct}%, forever</dd>
              <dt>Holders' share</dt><dd>{FEES.holderPct}%, per trade</dd>
              <dt>Liquidity</dt><dd>Locked forever</dd>
            </dl>
          </div>
        </aside>
      </div>
      <div className="mobilebar"><button className="big sell" type="submit" form="golive" disabled={busy || !f.name.trim()}>{cta}</button></div>
    </main>
  );
}
