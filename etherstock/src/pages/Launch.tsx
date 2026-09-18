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
import { WETH } from "../lib/stocks";
import { ensureWallet, openWalletModal } from "../lib/wallet";

type Step = 0 | 1 | 2;
const STEPS = [
  { t: "Identity", s: "Name, ticker, artwork, links" },
  { t: "Pair", s: "ETH or a tokenized stock" },
  { t: "Ignite", s: "Review, first buy, launch" },
];

/** Launch as three steps down one column, with the step list pinned on the left. */
export default function Launch() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { isConnected, address: me } = useAccount();
  const { data: ethUsd = 0 } = useEthUsd();
  const { data: quotes } = useQuotes();
  const [step, setStep] = useState<Step>(0);
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
  const canDevBuy = !pair || pair.ethRoute;
  const dev = Number(f.devBuy) > 0 ? f.devBuy.trim() : "";
  const ready0 = f.name.trim().length > 0;

  const submit = async () => {
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

  if (!DEPLOYED) return <main className="gate"><h1>Not live yet.</h1><p>The factory is not on Ethereum yet.</p><Link to="/" className="b">Back to the board</Link></main>;

  return (
    <main>
      <div className="band" style={{ gridTemplateColumns: "1fr", paddingBottom: 18 }}>
        <div><h1>Launch a coin that <em>burns</em>.</h1><p>One transaction. A fixed 1B supply, all of it in a Uniswap V4 pool at about $3,000, paired with ETH or a stock. Liquidity locked forever. From the first trade on, {FEES.burnPct}% of every fee buys it back and burns it.</p></div>
      </div>
      <div className="wiz">
        <div className="wiz-steps">
          {STEPS.map((s, i) => <button key={s.t} type="button" className={i === step ? "on" : i < step ? "done" : ""} disabled={i > step && !ready0} onClick={() => setStep(i as Step)}><span className="n">{i < step ? "✓" : i + 1}</span><span><b>{s.t}</b><small>{s.s}</small></span></button>)}
        </div>

        {step === 0 && (
          <div className="wiz-pane">
            <h2>Identity</h2>
            <p className="lead">What people see on the board. Everything here is stored on-chain with the coin.</p>
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
            <div className="wiz-nav"><span /><button className="b pri" disabled={!ready0} onClick={() => setStep(1)}>Next: pick the pair</button></div>
          </div>
        )}

        {step === 1 && (
          <div className="wiz-pane">
            <h2>Pair</h2>
            <p className="lead">The other side of the pool. The coin is priced in it, fees arrive in it, and buybacks are paid in it. {Math.max(0, pairs.length - 1)} stocks are approved.</p>
            <PairPicker pairs={pairs} value={pair?.address ?? WETH} onChange={(a) => { setPairAddr(a); setF({ ...f, devBuy: "" }); }} />
            <p className="note">{isEth
              ? "The pool holds ETH on the other side. Buyers pay ETH, your fees come in ETH."
              : pair.ethRoute
                ? `The pool holds ${pairSym}. Buyers still pay plain ETH; the router swaps through ${pairSym}'s pool. Your fees arrive in ${pairSym}, claimable as ETH.`
                : `${pairSym} has no on-chain pool right now: buyers must already hold ${pairSym}, and no ETH first buy is possible. Pick a stock marked "tradeable in ETH" for the easiest launch.`}</p>
            <div className="wiz-nav"><button className="b" onClick={() => setStep(0)}>Back</button><button className="b pri" onClick={() => setStep(2)}>Next: review</button></div>
          </div>
        )}

        {step === 2 && (
          <div className="wiz-pane">
            <h2>Ignite</h2>
            <p className="lead">Check it, decide on a first buy, and send one transaction.</p>
            <div className="review">
              <Art src={logo} name={f.name || "Your coin"} className="art" />
              <div>
                <h3>{f.name || "Your coin"} <span className="faint mono" style={{ fontSize: 13, fontWeight: 500 }}>{symbol}</span></h3>
                <dl className="kv">
                  <dt>Pair</dt><dd><span className={"chip " + (isEth ? "eth" : "stock")}>{pairSym}</span>{pair && pair.usd > 0 && <span className="faint"> at {usd(pair.usd)}</span>}</dd>
                  <dt>Supply</dt><dd>1,000,000,000 at launch, then only down</dd>
                  <dt>Opening cap</dt><dd>about $3,000, all supply in the pool</dd>
                  <dt>Trade fee</dt><dd>{FEES.taxPct}% · {FEES.creatorPct}% you · {FEES.burnPct}% burn · {FEES.platformPct}% platform</dd>
                  <dt>Liquidity</dt><dd>Locked forever</dd>
                </dl>
              </div>
            </div>
            <div className="f" style={{ marginTop: 18 }}>
              <label>First buy in ETH (optional)</label>
              <input className="in" inputMode="decimal" value={f.devBuy} onChange={set("devBuy")} placeholder="0" disabled={!canDevBuy} />
              <div className="help">{canDevBuy ? `Spent in the same transaction at the base ${FEES.taxPct}% fee, so you hold from block one. Everyone can see it.` : "Not available for a pair without an ETH route."}{dev && ethUsd > 0 && <> · about {usd(Number(dev) * ethUsd)}</>}</div>
            </div>
            <div className="terms"><b>What you cannot change later:</b> the name, ticker, pair and metadata are fixed at launch. The fee split is the same for every coin. No one, including you, can mint, pause or pull the liquidity.</div>
            <div className="wiz-nav"><button className="b" onClick={() => setStep(1)}>Back</button><button className="b fire lg" disabled={busy || !ready0} onClick={submit}>{!isConnected ? "Connect wallet" : busy ? "Launching…" : `Launch ${symbol}`}</button></div>
          </div>
        )}
      </div>
    </main>
  );
}
