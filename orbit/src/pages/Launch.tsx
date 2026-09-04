import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { parseAbi, parseEther, parseUnits, zeroAddress, type Address } from "viem";
import { useAccount } from "wagmi";

import { Art } from "../components/Art";
import { onair, publicClient } from "../lib/client";
import { ADDRESSES, FEES } from "../lib/env";
import { hype, usd, wei } from "../lib/format";
import { friendlyError, runTx, setToast, useConfig, useHypeUsd, useQuotes } from "../lib/hooks";
import { ONAIR_FACTORY_ABI, type Mode } from "../lib/onair";
import { ensureWallet, openWalletModal } from "../lib/wallet";

const FACTORY = parseAbi(["function tokenCount() view returns (uint256)", "function allTokens(uint256) view returns (address)"]);

export default function Launch() {
  const { isConnected } = useAccount();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: cfg } = useConfig();
  const { data: hypeUsd = 0 } = useHypeUsd();
  const { data: quotes } = useQuotes();
  const [pairAddr, setPairAddr] = useState<Address>(ADDRESSES.quote);
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>("auction");
  const [f, setF] = useState({ name: "", symbol: "", description: "", website: "", twitter: "", telegram: "", devBuy: "" });
  const [logo, setLogo] = useState("");
  const [logoSrc, setLogoSrc] = useState<ImageBitmap | null>(null);
  const [busy, setBusy] = useState(false);
  const { address: me } = useAccount();
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
      setLogoSrc(bmp);
      let out = render(bmp, 256, 0.8);
      if (out.length > 24_000) out = render(bmp, 256, 0.62);
      if (out.length > 24_000) out = render(bmp, 192, 0.62);
      if (out.length > 24_000) out = render(bmp, 128, 0.6);
      setLogo(out);
    } catch { setToast({ kind: "err", text: "Could not read that image. Try a PNG or JPG." }); }
  };

  /** HyperEVM's normal block holds 3M gas. Auction launches must fit it (no big
   *  blocks needed), and every KB of on-chain logo costs ~0.75M gas, so the
   *  logo is re-rendered smaller until the launch estimate fits. */
  const SMALL_BLOCK_GAS = 2_850_000n;
  const fitForSmallBlock = async (base: { name: string; symbol: string; devBuyQuote: bigint }, meta: Record<string, string>): Promise<{ metadataURI: string; gas: bigint; shrunk: boolean }> => {
    const est = async (m: Record<string, string>) => publicClient.estimateContractGas({
      address: ADDRESSES.factory, abi: ONAIR_FACTORY_ABI, functionName: "createAuction",
      args: [{ name: base.name, symbol: base.symbol, metadataURI: JSON.stringify(m), quote: zeroAddress, marketCapUsd8: 0n, devBuyQuote: base.devBuyQuote }],
      value: base.devBuyQuote, account: me!,
    });
    // Public RPCs cap eth_estimateGas well under what a big logo needs and
    // report that as a revert, so a failed estimate counts as "too big" and we
    // keep shrinking. Only the final, logo-free attempt surfaces its error.
    const tryEst = async (m: Record<string, string>) => { try { return await est(m); } catch { return null; } };
    let gas = await tryEst(meta);
    if (gas !== null && gas <= SMALL_BLOCK_GAS) return { metadataURI: JSON.stringify(meta), gas, shrunk: false };
    if (logoSrc) {
      for (const [size, q] of [[96, 0.55], [72, 0.5], [56, 0.45], [40, 0.4]] as [number, number][]) {
        const m = { ...meta, logo: render(logoSrc, size, q) };
        gas = await tryEst(m);
        if (gas !== null && gas <= SMALL_BLOCK_GAS) return { metadataURI: JSON.stringify(m), gas, shrunk: true };
      }
    }
    const m = { ...meta, logo: "" };
    gas = await est(m);
    return { metadataURI: JSON.stringify(m), gas, shrunk: true };
  };

  const symbol = (f.symbol.trim() || f.name.trim().replace(/[^a-zA-Z0-9]/g, "").slice(0, 6) || "COIN").toUpperCase();
  const url = (raw: string, p?: "x" | "tg") => { const s = raw.trim(); if (!s) return ""; if (s.startsWith("@") && p) return p === "x" ? `https://x.com/${s.slice(1)}` : `https://t.me/${s.slice(1)}`; return /^https?:\/\//i.test(s) ? s : `https://${s}`; };

  const floorUsd = cfg ? Number(cfg.floorMcapUsd8) / 1e8 : 3000;
  const bond = cfg ? wei(cfg.minRaiseWei) : 220;
  const hours = cfg ? Math.round((cfg.durationBlocks / 3600) * 10) / 10 : 4;
  const len = cfg && cfg.durationBlocks < 3600 ? `${Math.round(cfg.durationBlocks / 60)}-minute` : `${hours}-hour`;
  const minBid = cfg ? wei(cfg.minBidWei) : 0.05;
  const dev = Number(f.devBuy) > 0 ? f.devBuy.trim() : "";
  const devTooSmall = mode === "auction" && dev !== "" && Number(dev) < minBid;
  // Pair asset: auctions always pair HYPE; instant launches may pick a stock.
  const pairs = (quotes ?? []).filter((q) => q.approved);
  const pair = mode === "auction" ? pairs.find((q) => q.isNative) : pairs.find((q) => q.address.toLowerCase() === pairAddr.toLowerCase()) ?? pairs.find((q) => q.isNative);
  const pairSym = pair?.symbol ?? "HYPE";
  const pairNative = !pair || pair.isNative;
  const pairUsd = pair ? (pair.isNative ? hypeUsd || pair.usd : pair.usd) : hypeUsd;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim() || devTooSmall) return;
    if (!isConnected) return openWalletModal();
    setBusy(true);
    try {
      await ensureWallet();
      const meta = { description: f.description.trim(), logo, website: url(f.website), twitter: url(f.twitter, "x"), telegram: url(f.telegram, "tg") };
      const devWei = dev ? (pairNative ? parseEther(dev as `${number}`) : parseUnits(dev as `${number}`, pair!.decimals)) : 0n;
      let metadataURI = JSON.stringify(meta);
      if (mode === "auction") {
        // Fit a normal block so the launch never hangs in a wallet without big blocks.
        setToast({ kind: "busy", text: "Checking gas…" });
        try {
          const fit = await fitForSmallBlock({ name: f.name.trim(), symbol, devBuyQuote: devWei }, meta);
          metadataURI = fit.metadataURI;
          if (fit.shrunk) setToast({ kind: "busy", text: "Logo made smaller so the launch fits a normal block" });
        } catch (err) { setToast({ kind: "err", text: friendlyError(err) }); return; }
      }
      let created: `0x${string}` | null = null;
      const p = { name: f.name.trim(), symbol, metadataURI, devBuyQuote: devWei, quote: mode === "instant" && !pairNative ? pair!.address : undefined };
      const ok = await runTx(mode === "auction" ? `Open the ${symbol} auction` : `Launch ${symbol}`, () => (mode === "auction" ? onair.createAuction(p) : onair.createToken(p)), async () => {
        const n = (await publicClient.readContract({ address: ADDRESSES.factory, abi: FACTORY, functionName: "tokenCount" })) as bigint;
        created = (await publicClient.readContract({ address: ADDRESSES.factory, abi: FACTORY, functionName: "allTokens", args: [n - 1n] })) as `0x${string}`;
        await qc.invalidateQueries({ queryKey: ["tokens"] });
      });
      if (ok && created) nav(`/t/${created}`);
    } finally { setBusy(false); }
  };

  const cta = !isConnected ? "Connect wallet" : busy ? (mode === "auction" ? "Starting…" : "Launching…") : mode === "auction" ? `Start the ${symbol} auction` : `Launch ${symbol} now`;

  return (
    <main className="page">
      <section className="hero" style={{ gridTemplateColumns: "1fr", paddingBottom: 10 }}>
        <div>
          <div className="lbl" style={{ marginBottom: 12 }}>Launch a coin</div>
          <h1>Two ways to <em>launch</em>.</h1>
          <p className="sub">Run a {len} auction where everyone pays the same clearing price, or list instantly and trade from the first block, paired with HYPE or a tokenized stock. Either way the pool is locked and you earn {FEES.creatorPct}% of every trade's fee.</p>
        </div>
      </section>

      <div className="formats">
        <button type="button" className={"fmt auc " + (mode === "auction" ? "on" : "")} onClick={() => setMode("auction")}>
          <span className="lbl"><i className="dot a" style={{ animation: "none", boxShadow: "none", width: 7, height: 7 }} />Auction</span>
          <b>{len.replace("-", " ")}s, one price.</b>
          <span>Half the supply sells at a single rising clearing price. If it raises {bond} HYPE, the raise and the other half seed the pool. If not, everyone is refunded.</span>
        </button>
        <button type="button" className={"fmt " + (mode === "instant" ? "on" : "")} onClick={() => setMode("instant")}>
          <span className="lbl"><i className="dot" style={{ animation: "none", boxShadow: "none", width: 7, height: 7 }} />Instant</span>
          <b>Trading in one block.</b>
          <span>One transaction. The whole supply goes into a locked HyperSwap pool at {usd(floorUsd, { compact: true })} and trading starts immediately. Pair it with HYPE or any of {Math.max(0, pairs.length - 1)} tokenized stocks.</span>
        </button>
      </div>

      <div className="sign-m m-only">
        <Art src={logo} name={f.name || "Your coin"} className="av" size={48} />
        <div><b>{f.name || "Your coin"}</b><small className="mono">{symbol} · {mode === "auction" ? `auction · floor ${usd(floorUsd, { compact: true })}` : `${usd(floorUsd, { compact: true })} start`} · pairs {pairSym}</small></div>
        <span className={"onair " + (mode === "auction" ? "auc" : "")}><span className="dot" style={{ width: 6, height: 6, boxShadow: "none" }} />PREVIEW</span>
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
          {mode === "instant" && (
            <div className="field">
              <label>Pair</label>
              <select className="inp" value={pair?.address ?? ADDRESSES.quote} onChange={(e) => { setPairAddr(e.target.value as Address); setF({ ...f, devBuy: "" }); }}>
                {pairs.map((q) => <option key={q.address} value={q.address}>{q.isNative ? "HYPE · native" : `${q.symbol} · ${q.name} · ${usd(q.usd, { compact: true })}`}</option>)}
              </select>
              <div className="help">{pairNative ? "The pool holds HYPE on the other side. Buyers pay HYPE and your fees come in HYPE." : `The pool holds ${pairSym} on the other side. Buyers pay ${pairSym}, your fees come in ${pairSym}. Get ${pairSym} on Hyperliquid spot and transfer it to HyperEVM.`}</div>
            </div>
          )}
          <div className="field">
            <label>{mode === "auction" ? "Opening bid (optional)" : "First buy (optional)"}</label>
            <input inputMode="decimal" value={f.devBuy} onChange={set("devBuy")} placeholder="0" />
            <div className="help">
              {mode === "auction"
                ? `HYPE placed as your own bid in the same transaction, spread over the whole auction at up to 100× the floor. Minimum ${hype(minBid)} HYPE. Everyone can see it.`
                : pairNative ? "HYPE spent in the same transaction, so you hold from the first block. Everyone can see it." : `${pairSym} spent in the same transaction (you approve it first), so you hold from the first block. Everyone can see it.`}
              {dev && pairUsd > 0 && <> · ≈ {usd(Number(dev) * pairUsd)}</>}
            </div>
            {devTooSmall && <div className="warn" style={{ margin: 0 }}>Under the {hype(minBid)} HYPE minimum bid.</div>}
          </div>
          <button className="big sell d-only" type="submit" disabled={busy || !f.name.trim() || devTooSmall}>{cta}</button>
          <p className="note">
            {mode === "auction"
              ? <>Free, gas only, and it fits a normal HyperEVM block. When the auction ends the pool is seeded automatically; that step needs big blocks, and our keeper handles it.</>
              : <>Free, you pay HyperEVM gas only. Launching opens a pool, which needs <b style={{ color: "var(--ink)" }}>big blocks</b> turned on for your wallet once (Hyperliquid app → "Use big blocks for EVM"). Turn it back off after. Without big blocks the transaction never confirms.</>}
          </p>
        </form>

        <aside className="sign d-only">
          <div className={"onair " + (mode === "auction" ? "auc" : "")}><span className="dot" style={{ width: 7, height: 7, boxShadow: "none" }} />{mode === "auction" ? "AUCTION · PREVIEW" : "INSTANT · PREVIEW"}</div>
          <Art src={logo} name={f.name || "Your coin"} className="art" />
          <h3>{f.name || "Your coin"}</h3>
          <div className="small mono">{symbol} · {mode === "auction" ? `floor ${usd(floorUsd, { compact: true })}` : usd(floorUsd, { compact: true })} · just now</div>
          <div>
            <dl className="specs">
              <dt>Supply</dt><dd>1,000,000,000</dd>
              {mode === "auction" ? (
                <>
                  <dt>For sale</dt><dd>50% of supply</dd>
                  <dt>Floor price</dt><dd>≈ {usd(floorUsd, { compact: true })} FDV</dd>
                  <dt>Length</dt><dd>{len.replace("-", " ")}s</dd>
                  <dt>Bond</dt><dd>{bond} HYPE raised</dd>
                  <dt>After</dt><dd>Raise + 50% → pool</dd>
                </>
              ) : (
                <>
                  <dt>Starting market cap</dt><dd>≈ {usd(floorUsd, { compact: true })}</dd>
                  <dt>Pair</dt><dd>{pairSym}</dd>
                </>
              )}
              <dt>Trade fee</dt><dd>{FEES.poolPct}%</dd>
              <dt>Your share of fees</dt><dd>{FEES.creatorPct}%, forever</dd>
              <dt>Liquidity</dt><dd>Locked</dd>
            </dl>
          </div>
        </aside>
      </div>
      <div className="mobilebar"><button className="big sell" type="submit" form="golive" disabled={busy || !f.name.trim() || devTooSmall}>{cta}</button></div>
    </main>
  );
}
