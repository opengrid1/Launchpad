import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { parseEther, type Address } from "viem";
import { useAccount } from "wagmi";

import { PairPicker } from "../components/PairPicker";
import { client } from "../lib/client";
import { DEPLOYED, FEES } from "../lib/env";
import { usd } from "../lib/format";
import { friendlyError, runTx, setToast, useEthUsd, useQuotes } from "../lib/hooks";
import { isTokenPair, WETH } from "../lib/stocks";
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

  if (!DEPLOYED) return <main className="gate"><h1>Not live yet</h1><p>The factory is not on Ethereum yet.</p><Link to="/" className="b">Back to coins</Link></main>;
  const cta = !isConnected ? "Connect wallet" : busy ? "Launching…" : `Launch ${symbol}`;

  return (
    <main className="launch">
      <h1>Launch a coin</h1>
      <p className="sub">One transaction. 1,000,000,000 supply into a Uniswap V4 pool at about $3,000 market cap. Liquidity is burned.</p>

      <form className="card" onSubmit={submit}>
        <div className="fs">
          <h3>Coin</h3>
          <label className="drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const file = e.dataTransfer.files?.[0]; if (file) onFile(file); }}>
            {logo ? <img src={logo} alt="" /> : <div className="ph">+</div>}
            <div><div className="t">{logo ? "Logo added" : "Upload a logo"}</div><div className="help">Square PNG or JPG. Stored on-chain, so it is kept small.{logo && <> · <a href="#" onClick={(e) => { e.preventDefault(); setLogo(""); }}>Remove</a></>}</div></div>
            <input ref={fileRef} type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (file) onFile(file); }} />
          </label>
          <div className="f2">
            <div className="f"><label>Name</label><input className="in" value={f.name} onChange={set("name")} placeholder="Moon Cat" maxLength={40} required /></div>
            <div className="f"><label>Ticker</label><input className="in" value={f.symbol} onChange={set("symbol")} placeholder={symbol} maxLength={10} style={{ textTransform: "uppercase" }} /></div>
          </div>
          <div className="f"><label>Description</label><textarea className="in" value={f.description} onChange={set("description")} placeholder="What is this coin about?" maxLength={400} /></div>
          <div className="f2">
            <div className="f"><label>Website</label><input className="in" value={f.website} onChange={set("website")} placeholder="example.com" /></div>
            <div className="f"><label>X</label><input className="in" value={f.twitter} onChange={set("twitter")} placeholder="@handle" /></div>
          </div>
          <div className="f"><label>Telegram</label><input className="in" value={f.telegram} onChange={set("telegram")} placeholder="@group" /></div>
        </div>

        <div className="fs">
          <h3>Pair asset<small>What the coin is priced in and what holders are paid in</small></h3>
          <PairPicker pairs={pairs} value={pair?.address ?? WETH} onChange={(a) => { setPairAddr(a); setF({ ...f, devBuy: "" }); }} />
          <div className="f" style={{ marginTop: 10 }}>
            <div className="help">
              <span className={"chip " + kind} style={{ marginRight: 8 }}>{pairSym}</span>
              {isEth
                ? "The pool holds ETH. Buyers pay ETH and holders are paid in ETH."
                : pair.ethRoute
                  ? `The pool holds ${pairSym}. Buyers still pay ETH; the router swaps through ${pairSym}. Holders and you are paid in ${pairSym}, claimable as ETH.`
                  : `${pairSym} has no ETH route: buyers must already hold ${pairSym}, and no ETH first buy is possible.`}
            </div>
          </div>
        </div>

        <div className="fs">
          <h3>First buy<small>Optional</small></h3>
          <div className="f">
            <label>Amount in ETH</label>
            <input className="in" inputMode="decimal" value={f.devBuy} onChange={set("devBuy")} placeholder="0" disabled={!canDevBuy} />
            <div className="help">{canDevBuy ? `Bought in the same transaction at the ${FEES.taxPct}% fee, so you hold from block one.` : "Not available for a pair without an ETH route."}{dev && ethUsd > 0 && <> About {usd(Number(dev) * ethUsd)}.</>}</div>
          </div>
        </div>

        <div className="fs summary">
          <h3>Summary</h3>
          <dl className="kv">
            <dt>Coin</dt><dd>{f.name || "—"} ({symbol})</dd>
            <dt>Pair</dt><dd>{isEth ? "ETH" : `${pair.name} (${pairSym})`}{pair && pair.usd > 0 ? ` · ${usd(pair.usd)}` : ""}</dd>
            <dt>Supply</dt><dd>1,000,000,000, fixed</dd>
            <dt>Opening</dt><dd>About $3,000 market cap, all in the pool</dd>
            <dt>Fee</dt><dd>{FEES.taxPct}% per trade: {FEES.holderPct}% holders / {FEES.creatorPct}% you / {FEES.platformPct}% platform</dd>
            <dt>Liquidity</dt><dd>Burned at launch</dd>
            <dt>Launch protection</dt><dd>99% fee fading to {FEES.taxPct}% over 30 seconds, 1% wallet cap for 10 blocks</dd>
          </dl>
          <button className="b pri lg wide" type="submit" disabled={busy || !f.name.trim()} style={{ marginTop: 16 }}>{cta}</button>
        </div>
      </form>
    </main>
  );
}
