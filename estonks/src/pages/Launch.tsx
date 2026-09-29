import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { parseEther, type Address } from "viem";
import { useAccount } from "wagmi";

import { Icon } from "../components/Icon";
import { client } from "../lib/client";
import { DEPLOYED, FEES } from "../lib/env";
import { usd } from "../lib/format";
import { friendlyError, runTx, setToast, useEthUsd, useQuotes } from "../lib/hooks";
import { WETH } from "../lib/stocks";
import { ensureWallet, openWalletModal } from "../lib/wallet";

const QUICK = ["0", "0.05", "0.1", "0.25", "0.5"];

/** Launch: coin, pair, first buy, preview. One transaction. */
export default function Launch() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { isConnected, address: me } = useAccount();
  const { data: ethUsd = 0 } = useEthUsd();
  const { data: quotes } = useQuotes();
  const [pairAddr, setPairAddr] = useState<Address>(WETH);
  const [pq, setPq] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [f, setF] = useState({ name: "", symbol: "", description: "", website: "", twitter: "", telegram: "", devBuy: "0" });
  const [logo, setLogo] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

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
  const pairs = useMemo(() => (quotes ?? []).filter((q) => q.approved), [quotes]);
  const shown = useMemo(() => { const s = pq.trim().toLowerCase(); return s ? pairs.filter((p) => `${p.symbol} ${p.name}`.toLowerCase().includes(s)) : pairs.slice(0, 12); }, [pairs, pq]);
  const pair = pairs.find((q) => q.address.toLowerCase() === pairAddr.toLowerCase()) ?? pairs.find((q) => q.isNative);
  const pairSym = pair?.symbol ?? "ETH";
  const canDevBuy = !pair || pair.ethRoute;
  const dev = Number(f.devBuy) > 0 ? f.devBuy.trim() : "";
  const ready = f.name.trim().length > 0;

  const submit = async () => {
    if (!isConnected) return openWalletModal();
    if (!pair || !ready) return;
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

  if (!DEPLOYED) return <main className="gate"><h1>Not live yet.</h1><p className="lede">The factory is not on Ethereum yet.</p><Link to="/" className="btn dim">Home</Link></main>;

  const preview = (
    <div className="lf-preview">
      <span className="label">Preview</span>
      <div className="lf-prev">
        <span className={"chip " + (logo ? "" : "def")}><img src={logo || "/default-coin.png"} alt="" /></span>
        <span className="t"><span className="n"><b>{symbol}</b><span className={"badge " + (!pair || pair.isNative ? "eth" : "stock")}>{pairSym}</span></span><span className="d">{f.name.trim() || "Your coin"} · 0 holders</span></span>
        <span className="badge mute">new</span>
      </div>
      <div className="lf-sum">
        <div className="kv"><span>Supply</span><b>1,000,000,000</b></div>
        <div className="kv"><span>Liquidity</span><b>Uniswap V4</b></div>
        <div className="kv"><span>Trade fee</span><b>{FEES.taxPct}%</b></div>
        <div className="kv"><span><i className="sw" style={{ background: "#ffab7a" }} />You</span><b>{(FEES.taxPct * FEES.creatorPct / 100).toFixed(1)}%</b></div>
        <div className="kv"><span><i className="sw" style={{ background: "#9b7dff" }} />Holders, in {pairSym}</span><b>{(FEES.taxPct * FEES.holderPct / 100).toFixed(1)}%</b></div>
        <div className="kv"><span><i className="sw" style={{ background: "#e3b657" }} />STONK holders</span><b>{(FEES.taxPct * FEES.platformPct / 100).toFixed(1)}%</b></div>
        <div className="kv"><span>First buy</span><b>{dev ? `${dev} ETH` : "none"}</b></div>
      </div>
      <button className="btn pri lg wide" disabled={busy || !ready} onClick={submit}>{!isConnected ? "Connect wallet" : busy ? "Launching…" : `Launch ${symbol}`}</button>
      <span className="lf-cost">{dev ? `${dev} ETH + gas` : "gas only"}{dev && ethUsd > 0 ? ` · about ${usd(Number(dev) * ethUsd)}` : ""}</span>
    </div>
  );

  return (
    <main className="lf">
      <form className="lf-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div style={{ paddingTop: 14 }}><h1>Launch a coin.</h1><p className="lede">One transaction. The whole supply goes into a Uniswap V4 pool paired with ETH or a stock.</p></div>

        <section className="lf-sec"><div className="lf-head"><h2>Coin</h2></div>
          <div className="lf-group">
            <div className="lf-id">
              <button type="button" className="lf-img" onClick={() => fileRef.current?.click()} aria-label="Add image">{logo ? <img src={logo} alt="" /> : <><Icon name="image" size={22} /><span>Image</span></>}</button>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) onFile(file); }} />
              <div className="lf-stack">
                <label className="lf-f"><span>Name</span><input value={f.name} onChange={set("name")} placeholder="Pepe on Nvidia" maxLength={40} /></label>
                <label className="lf-f"><span>Ticker</span><input className="mono up" value={f.symbol} onChange={set("symbol")} placeholder={symbol} maxLength={10} /></label>
              </div>
            </div>
            <label className="lf-f"><span>About</span><input value={f.description} onChange={set("description")} placeholder="One line about the coin" maxLength={280} /></label>
            <label className="lf-f"><span>X</span><input value={f.twitter} onChange={set("twitter")} placeholder="@handle" /></label>
            <label className="lf-f"><span>Telegram</span><input value={f.telegram} onChange={set("telegram")} placeholder="t.me/group" /></label>
            <label className="lf-f"><span>Website</span><input value={f.website} onChange={set("website")} placeholder="https://" /></label>
          </div>
        </section>

        <section className="lf-sec"><div className="lf-head"><h2>Pair</h2><span className="lf-hint">Rewards are paid in the pair</span></div>
          <div className="lf-group">
            <label className="lf-search"><Icon name="search" size={16} /><input placeholder={`Search ${Math.max(0, pairs.length - 1)} Ondo stocks`} value={pq} onChange={(e) => setPq(e.target.value)} /></label>
            <div className="lf-pairs">
              {shown.length === 0 && <span className="lf-hint">No pair matches.</span>}
              {shown.map((p) => { const on = p.address.toLowerCase() === (pair?.address ?? WETH).toLowerCase(); return (
                <button type="button" key={p.address} className={"pair " + (on ? "on" : "")} onClick={() => { setPairAddr(p.address); if (!p.ethRoute) setF({ ...f, devBuy: "0" }); }}>
                  <span className={"badge " + (p.isNative ? "eth" : "stock")}>{p.symbol}</span><span className="pn">{p.isNative ? "Ether" : p.name}</span><span className="pp">{p.isNative ? "native" : p.ethRoute ? usd(p.usd) : "hold to buy"}</span>
                </button>); })}
            </div>
          </div>
          {pair && !pair.isNative && !pair.ethRoute && <p className="note">{pairSym} has no ETH route on chain yet. Buyers must hold {pairSym}, and a first buy in ETH is not possible.</p>}
        </section>

        <section className="lf-sec"><div className="lf-head"><h2>First buy</h2><span className="lf-hint">Optional</span></div>
          <div className="lf-group">
            <div className="lf-amt"><input inputMode="decimal" value={f.devBuy} onChange={set("devBuy")} disabled={!canDevBuy} aria-label="First buy in ETH" /><span className="u">ETH</span><span className="usd">{Number(f.devBuy) > 0 && ethUsd > 0 ? usd(Number(f.devBuy) * ethUsd) : "$0"}</span></div>
            <div className="lf-quick">{QUICK.map((v) => <button type="button" key={v} className={f.devBuy === v ? "on" : ""} disabled={!canDevBuy && v !== "0"} onClick={() => setF({ ...f, devBuy: v })}>{v}</button>)}</div>
          </div>
        </section>
        <div className="m-only">{preview}</div>
      </form>
      <aside className="lf-side d-only">{preview}</aside>
    </main>
  );
}
