import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { parseEther, type Address } from "viem";
import { useAccount } from "wagmi";

import { Art } from "../components/Art";
import { PairPicker } from "../components/PairPicker";
import { client } from "../lib/client";
import { DEPLOYED, FEES } from "../lib/env";
import { usd } from "../lib/format";
import { friendlyError, runTx, setToast, useEthUsd, useQuotes } from "../lib/hooks";
import { isTokenPair, WETH } from "../lib/stocks";
import { ensureWallet, openWalletModal } from "../lib/wallet";

/** One form with the pair picker in the middle of it, and a live summary that
 *  follows on the right. */
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
  const isEth = !pair || pair.isNative;
  const kind = isEth ? "eth" : isTokenPair(pair.address) ? "token" : "stock";
  const canDevBuy = !pair || pair.ethRoute;
  const dev = Number(f.devBuy) > 0 ? f.devBuy.trim() : "";

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

  if (!DEPLOYED) return <main className="gate"><h1>Not live yet.</h1><p>The factory is not on Ethereum yet.</p><Link to="/" className="b ghost">Back to coins</Link></main>;
  const cta = !isConnected ? "Connect wallet" : busy ? "Launching…" : `Launch ${symbol} paired with ${pairSym}`;

  return (
    <main>
      <div className="eyebrow">One transaction · about $3,000 opening pool</div>
      <h1 style={{ marginTop: 10 }}>Launch a coin paired with <span className="horn-text">{pairSym}</span>.</h1>
      <p className="lead" style={{ color: "var(--ink2)", fontSize: 16, maxWidth: "56ch", margin: "14px 0 0" }}>A fixed 1B supply, all of it in a Uniswap V4 pool against the pair you choose. From the first trade, {FEES.holderPct}% of every fee is paid to whoever holds the coin, in {pairSym}.</p>

      <div className="launch">
        <form className="pane form" id="golive" onSubmit={submit}>
          <label className="drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const file = e.dataTransfer.files?.[0]; if (file) onFile(file); }}>
            {logo ? <img src={logo} alt="" /> : <div className="ph">+</div>}
            <div><div className="t">{logo ? "Artwork ready" : "Add artwork"}</div><div className="help">Square PNG or JPG, kept small on-chain.{logo && <> · <a href="#" onClick={(e) => { e.preventDefault(); setLogo(""); }}>Remove</a></>}</div></div>
            <input ref={fileRef} type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (file) onFile(file); }} />
          </label>
          <div className="f2">
            <div className="f"><label>Name</label><input className="in" value={f.name} onChange={set("name")} placeholder="Moon Cat" maxLength={40} required /></div>
            <div className="f"><label>Ticker</label><input className="in" value={f.symbol} onChange={set("symbol")} placeholder={symbol} maxLength={10} style={{ textTransform: "uppercase" }} /><div className="help">Up to 10 characters. Blank derives from the name.</div></div>
          </div>
          <div className="f"><label>Description</label><textarea className="in" value={f.description} onChange={set("description")} placeholder="What is this coin about?" maxLength={400} /></div>
          <div className="f2">
            <div className="f"><label>Website</label><input className="in" value={f.website} onChange={set("website")} placeholder="example.com" /></div>
            <div className="f"><label>X</label><input className="in" value={f.twitter} onChange={set("twitter")} placeholder="@handle" /></div>
          </div>
          <div className="f"><label>Telegram</label><input className="in" value={f.telegram} onChange={set("telegram")} placeholder="@group" /></div>

          <div className="f">
            <label>Pair asset · what the coin is priced in and holders are paid in</label>
            <PairPicker pairs={pairs} value={pair?.address ?? WETH} onChange={(a) => { setPairAddr(a); setF({ ...f, devBuy: "" }); }} />
            <div className="help">{isEth
              ? "The pool holds ETH on the other side. Buyers pay ETH and holders are paid in ETH."
              : pair.ethRoute
                ? `The pool holds ${pairSym}. Buyers still pay plain ETH; the router swaps through ${pairSym}'s pool. Holders and you are paid in ${pairSym}, claimable as ETH.`
                : `${pairSym} has no on-chain route right now: buyers must already hold ${pairSym}, and no ETH first buy is possible.`}</div>
          </div>
          <div className="f">
            <label>First buy in ETH (optional)</label>
            <input className="in" inputMode="decimal" value={f.devBuy} onChange={set("devBuy")} placeholder="0" disabled={!canDevBuy} />
            <div className="help">{canDevBuy ? `Spent in the same transaction at the base ${FEES.taxPct}% fee, so you hold from block one. Everyone can see it.` : "Not available for a pair without an ETH route."}{dev && ethUsd > 0 && <> · about {usd(Number(dev) * ethUsd)}</>}</div>
          </div>
          <button className="b horn lg wide" type="submit" disabled={busy || !f.name.trim()}>{cta}</button>
        </form>

        <aside className="pane summary">
          <div className="top-line"><Art src={logo} name={f.name || "Your coin"} className="art" /><div><h3>{f.name || "Your coin"}</h3><span className="faint mono" style={{ fontSize: 12 }}>{symbol}</span></div></div>
          <div className="pairline">
            <span className={"chip " + kind}>{pairSym}</span>
            <b style={{ display: "block", marginTop: 8 }}>{isEth ? "Paired with Ether" : `Paired with ${pair.name}`}</b>
            <small>{pair && pair.usd > 0 ? `${pairSym} at ${usd(pair.usd)} · ` : ""}rewards paid in {pairSym}</small>
          </div>
          <dl className="kv">
            <dt>Supply</dt><dd>1,000,000,000 fixed</dd>
            <dt>Opening cap</dt><dd>about $3,000, all in the pool</dd>
            <dt>Trade fee</dt><dd>{FEES.taxPct}%</dd>
            <dt>Holders get</dt><dd>{FEES.holderPct}% of every fee, per trade</dd>
            <dt>You get</dt><dd>{FEES.creatorPct}% of every fee, forever</dd>
            <dt>Liquidity</dt><dd>Burned forever</dd>
          </dl>
          <div className="terms"><b>Fixed at launch:</b> name, ticker, pair and metadata. No one can mint, pause or pull the liquidity. The first 30 seconds carry a 99% fee that fades to {FEES.taxPct}%, and wallets are capped at 1% for ten blocks.</div>
        </aside>
      </div>
    </main>
  );
}
