import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { parseAbi, parseEther } from "viem";
import { useAccount } from "wagmi";

import { Art } from "../components/Art";
import { client, publicClient } from "../lib/client";
import { ADDRESSES } from "../lib/env";
import { runTx, setToast } from "../lib/hooks";
import { ensureWallet, openWalletModal } from "../lib/wallet";

const FACTORY = parseAbi(["function tokenCount() view returns (uint256)", "function allTokens(uint256) view returns (address)"]);

export default function Launch() {
  const { isConnected } = useAccount();
  const nav = useNavigate();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [f, setF] = useState({ name: "", symbol: "", description: "", website: "", twitter: "", telegram: "", devBuy: "" });
  const [logo, setLogo] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const onFile = async (file: File) => {
    try {
      const bmp = await createImageBitmap(file);
      const render = (size: number, q: number) => {
        const c = document.createElement("canvas"); c.width = size; c.height = size;
        const ctx = c.getContext("2d")!; const side = Math.min(bmp.width, bmp.height);
        ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
        const w = c.toDataURL("image/webp", q); return w.startsWith("data:image/webp") ? w : c.toDataURL("image/jpeg", q);
      };
      let out = render(256, 0.8);
      if (out.length > 24_000) out = render(256, 0.62);
      if (out.length > 24_000) out = render(192, 0.62);
      if (out.length > 24_000) out = render(128, 0.6);
      setLogo(out);
    } catch { setToast({ kind: "err", text: "Could not read that image. Try a PNG or JPG." }); }
  };

  const symbol = (f.symbol.trim() || f.name.trim().replace(/[^a-zA-Z0-9]/g, "").slice(0, 6) || "COIN").toUpperCase();
  const url = (raw: string, p?: "x" | "tg") => { const s = raw.trim(); if (!s) return ""; if (s.startsWith("@") && p) return p === "x" ? `https://x.com/${s.slice(1)}` : `https://t.me/${s.slice(1)}`; return /^https?:\/\//i.test(s) ? s : `https://${s}`; };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) return;
    if (!isConnected) return openWalletModal();
    setBusy(true);
    try {
      await ensureWallet();
      const metadataURI = JSON.stringify({ description: f.description.trim(), logo, website: url(f.website), twitter: url(f.twitter, "x"), telegram: url(f.telegram, "tg") });
      const dev = Number(f.devBuy) > 0 ? parseEther(f.devBuy.trim() as `${number}`) : 0n;
      let created: `0x${string}` | null = null;
      const ok = await runTx(`Launch ${symbol}`, () => client.createToken({ name: f.name.trim(), symbol, metadataURI, quote: ADDRESSES.quote, devBuyQuote: dev }), async () => {
        const n = (await publicClient.readContract({ address: ADDRESSES.factory, abi: FACTORY, functionName: "tokenCount" })) as bigint;
        created = (await publicClient.readContract({ address: ADDRESSES.factory, abi: FACTORY, functionName: "allTokens", args: [n - 1n] })) as `0x${string}`;
        await qc.invalidateQueries({ queryKey: ["tokens"] });
      });
      if (ok && created) nav(`/t/${created}`);
    } finally { setBusy(false); }
  };

  return (
    <main className="page">
      <section className="hero" style={{ gridTemplateColumns: "1fr", paddingBottom: 10 }}>
        <div>
          <div className="lbl" style={{ marginBottom: 12 }}>Studio · go live</div>
          <h1>On air in <em>one</em><br />transaction.</h1>
          <p className="sub">No upfront liquidity. One billion supply, seeded into a HyperSwap pool that is locked forever. You earn 40% of every trade's fee for as long as it trades.</p>
        </div>
      </section>

      <div className="sign-m m-only">
        <Art src={logo} name={f.name || "Your coin"} className="av" size={48} />
        <div><b>{f.name || "Your coin"}</b><small className="mono">{symbol} · $3.0K start · pairs HYPE</small></div>
        <span className="onair"><span className="dot" style={{ width: 6, height: 6, boxShadow: "none" }} />PREVIEW</span>
      </div>
      <div className="split">
        <form className="form" id="golive" onSubmit={submit}>
          <label className="drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const file = e.dataTransfer.files?.[0]; if (file) onFile(file); }}>
            {logo ? <img src={logo} alt="" /> : <div className="ph">+</div>}
            <div><div style={{ fontWeight: 500 }}>{logo ? "Artwork ready" : "Add artwork"}</div><div className="help">Square PNG or JPG. Stored on-chain with the coin.{logo && <> · <a href="#" onClick={(e) => { e.preventDefault(); setLogo(""); }}>Remove</a></>}</div></div>
            <input ref={fileRef} type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (file) onFile(file); }} />
          </label>
          <div className="field"><label>Name</label><input value={f.name} onChange={set("name")} placeholder="Moon Cat" maxLength={40} required /></div>
          <div className="field"><label>Ticker</label><input value={f.symbol} onChange={set("symbol")} placeholder={symbol} maxLength={10} style={{ textTransform: "uppercase" }} /><div className="help">Up to 10 characters. Leave blank to derive from the name.</div></div>
          <div className="field"><label>Description</label><textarea value={f.description} onChange={set("description")} placeholder="What is this coin about?" maxLength={600} /></div>
          <div className="split2">
            <div className="field"><label>Website</label><input value={f.website} onChange={set("website")} placeholder="example.com" /></div>
            <div className="field"><label>X</label><input value={f.twitter} onChange={set("twitter")} placeholder="@handle" /></div>
          </div>
          <div className="field"><label>Telegram</label><input value={f.telegram} onChange={set("telegram")} placeholder="@group" /></div>
          <div className="field"><label>First buy (optional)</label><input inputMode="decimal" value={f.devBuy} onChange={set("devBuy")} placeholder="0" /><div className="help">HYPE spent in the same transaction, so you hold from the first block. Everyone can see it.</div></div>
          <button className="big sell d-only" type="submit" disabled={busy || !f.name.trim()}>{!isConnected ? "Connect wallet" : busy ? "Going live…" : `Go live with ${symbol}`}</button>
          <p className="note">Free, you pay HyperEVM gas only. Launching deploys a pool, which needs <b style={{ color: "var(--ink)" }}>big blocks</b> turned on for your wallet once (Hyperliquid app → "Use big blocks for EVM"). Turn it back off after.</p>
        </form>

        <aside className="sign d-only">
          <div className="onair"><span className="dot" style={{ width: 7, height: 7, boxShadow: "none" }} />ON AIR · PREVIEW</div>
          <Art src={logo} name={f.name || "Your coin"} className="art" />
          <h3>{f.name || "Your coin"}</h3>
          <div className="small mono">{symbol} · $3.0K · just now</div>
          <div>
            <dl className="specs">
              <dt>Supply</dt><dd>1,000,000,000</dd>
              <dt>Starting market cap</dt><dd>≈ $3,000</dd>
              <dt>Pair</dt><dd>HYPE</dd>
              <dt>Trade fee</dt><dd>1%</dd>
              <dt>Your share of fees</dt><dd>40%, forever</dd>
              <dt>Holders' share</dt><dd>50%</dd>
              <dt>Liquidity</dt><dd>Locked</dd>
            </dl>
          </div>
        </aside>
      </div>
      <div className="mobilebar"><button className="big sell" type="submit" form="golive" disabled={busy || !f.name.trim()}>{!isConnected ? "Connect wallet" : busy ? "Going live…" : `Go live with ${symbol}`}</button></div>
    </main>
  );
}
