import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { keccak256, parseEther, toHex } from "viem";

import { client } from "../lib/client";
import { env } from "../lib/env";
import { IS_INK } from "../lib/brand";
import { STOCKS, WHYPE, type HyperStock } from "../lib/hyper/stocks";
import { ensureSdkWallet, errorText, useWallet } from "../lib/useWallet";
import { useUi } from "../store";

const TOKEN_CREATED_TOPIC = keccak256(
  toHex("TokenCreated(address,address,string,string,string,uint256)"),
);

// The launch pair options: WHYPE (default) plus every tokenized stock live on
// HyperEVM. The pool's 1% fee is paid in whichever they pick.
type Pair = { symbol: string; label: string; sub: string; address: `0x${string}` };
const WHYPE_PAIR: Pair = IS_INK
  ? { symbol: "ETH", label: "ETH", sub: "Ink", address: "0x4200000000000000000000000000000000000006" as `0x${string}` }
  : { symbol: "HYPE", label: "HYPE", sub: "Hyperliquid", address: WHYPE };
const STOCK_PAIRS: Pair[] = STOCKS.map((s: HyperStock) => ({
  symbol: s.ticker,
  label: s.ticker,
  sub: s.name,
  address: s.address,
}));
const ALL_PAIRS: Pair[] = [WHYPE_PAIR, ...STOCK_PAIRS];

/**
 * hyperstock launch (HyperEVM / HyperSwap V3). One transaction mints a plain
 * ERC-20, opens its HyperSwap pool paired with the chosen asset, and seeds the
 * full supply single-sided. The pool's 1% fee splits 50% holders / 40%
 * creator / 10% platform, forever.
 */
export function LaunchHyper({ onCancel }: { onCancel?: () => void } = {}) {
  const { isConnected, connectFirst } = useWallet();
  const pushToast = useUi((s) => s.pushToast);
  const navigate = useNavigate();

  const [form, setForm] = useState({ name: "", symbol: "", description: "", website: "", twitter: "", telegram: "" });
  const [pair, setPair] = useState<`0x${string}`>(WHYPE_PAIR.address);
  const [devBuy, setDevBuy] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [logoData, setLogoData] = useState("");
  const [tried, setTried] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const set =
    (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  const selected = ALL_PAIRS.find((p) => p.address === pair)!;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ALL_PAIRS;
    return ALL_PAIRS.filter((p) => `${p.label} ${p.sub}`.toLowerCase().includes(q));
  }, [query]);

  const onLogoFile = async (file: File) => {
    try {
      const bitmap = await createImageBitmap(file);
      const render = (size: number, quality: number) => {
        const canvas = document.createElement("canvas");
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext("2d")!;
        const side = Math.min(bitmap.width, bitmap.height);
        ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
        const webp = canvas.toDataURL("image/webp", quality);
        return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", quality);
      };
      let out = render(256, 0.8);
      if (out.length > 24_000) out = render(256, 0.62);
      if (out.length > 24_000) out = render(192, 0.62);
      if (out.length > 24_000) out = render(128, 0.6);
      setLogoData(out);
    } catch {
      pushToast({ kind: "error", title: "Could not read that image", body: "Try a PNG or JPG file." });
    }
  };

  const nameError = tried && !form.name.trim() ? "Token name is required." : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!form.name.trim()) return;
    if (!isConnected) return connectFirst();
    setBusy(true);
    try {
      if (!(await ensureSdkWallet())) throw new Error("Wallet session expired. Reconnect and try again.");
      const url = (raw: string, platform?: "x" | "telegram") => {
        const s = raw.trim();
        if (!s) return "";
        if (s.startsWith("@") && platform) return platform === "x" ? `https://x.com/${s.slice(1)}` : `https://t.me/${s.slice(1)}`;
        return /^https?:\/\//i.test(s) ? s : `https://${s}`;
      };
      const metadata = JSON.stringify({
        description: form.description.trim(),
        logo: logoData,
        website: url(form.website),
        twitter: url(form.twitter, "x"),
        telegram: url(form.telegram, "telegram"),
        pair: selected.symbol,
        pairAddress: pair,
      });
      // The dev buy rides inside the launch transaction itself (the factory
      // swaps it through the fresh pool atomically, coins land in the
      // creator's wallet). For a stock pair the client first ensures the
      // factory has an allowance for the stock.
      const devAmt = Number(devBuy) > 0 ? devBuy.trim() : "";
      const hash = await (client as any).createToken({
        name: form.name.trim(),
        symbol: (form.symbol.trim() || form.name.trim().replace(/[^a-zA-Z0-9]/g, "").slice(0, 6) || "TOKEN").toUpperCase(),
        metadataURI: metadata,
        quote: pair,
        devBuyQuote: devAmt ? parseEther(devAmt as `${number}`) : 0n,
      });
      pushToast({ kind: "info", title: "Launch submitted", txHash: hash });
      const receipt = await client.publicClient.waitForTransactionReceipt({ hash });
      const log = receipt.logs.find((l) => l.topics[0] === TOKEN_CREATED_TOPIC);
      pushToast({
        kind: "success",
        title: "Coin is live",
        body: `Market open, paired with ${selected.label}.${devAmt ? ` Dev buy of ${devAmt} ${selected.label} filled.` : ""}`,
        txHash: hash,
      });
      const tokenAddr = log?.topics[1] ? (`0x${log.topics[1].slice(26)}` as `0x${string}`) : null;
      if (tokenAddr) navigate(`/token/${tokenAddr}`);
      else navigate("/");
    } catch (err) {
      pushToast({ kind: "error", title: "Launch failed", body: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`kf kf-page kf-launch${IS_INK ? " lf" : ""}`}>
      <h1 className="kf-launch-h1">Launch a coin</h1>
      <p className="kf-launch-sub">
        {IS_INK
          ? "One transaction opens a live Uniswap market on Ink with the full supply. Every buy auto-pays 1%: 0.5% holders, 0.4% you, 0.1% platform, paid out in the pair stock."
          : `Deploy a coin on HyperEVM paired with ${env.nativeSymbol} or a tokenized stock. One transaction opens a live HyperSwap market and seeds the full supply. Every trade pays you, the creator, 1% forever.`}
      </p>

      {/* Big-blocks notice — a launch deploys a V3 pool (~6M gas), above HyperEVM's small-block limit. */}
      {IS_INK ? null : <div style={{
        margin: "12px 16px 0",
        border: "1px solid var(--color-edge)",
        background: "var(--color-panel-2)",
        borderRadius: 12,
        padding: 12,
        fontSize: 11.5,
        lineHeight: 1.6,
        color: "var(--color-ink-2)",
      }}>
        <b style={{ color: "var(--color-accent-ink)" }}>One-time setup:</b> launching deploys a pool, which needs HyperEVM{" "}
        <b>big blocks</b> enabled on your wallet. Turn on “Use big blocks for EVM” in the{" "}
        <a href="https://app.hyperliquid.xyz" target="_blank" rel="noreferrer" style={{ color: "var(--color-accent-ink)", textDecoration: "underline" }}>Hyperliquid app</a>,
        launch here, then turn it back off (big blocks confirm about once a minute, so leaving it on
        slows your normal transactions). Trading needs nothing special.
      </div>}

      <form onSubmit={submit} className="kf-form">
        <div className="kf-field lf-half">
          <label>Token Name</label>
          <input type="text" value={form.name} onChange={set("name")} placeholder="Enter token name..." maxLength={48}
            className={nameError ? "err" : undefined} aria-invalid={!!nameError} />
          {nameError ? <p className="kf-err-msg">{nameError}</p> : null}
        </div>

        <div className="kf-field lf-half">
          <label>Ticker Symbol <i>(optional)</i></label>
          <input type="text" value={form.symbol} onChange={set("symbol")} placeholder="e.g. COIN" maxLength={12} />
          {IS_INK ? null : <p className="hint">Auto-generated from the name if left blank.</p>}
        </div>

        <div className="kf-field">
          <label>Description <i>(optional)</i></label>
          <textarea value={form.description} onChange={set("description")} placeholder="What is this coin about?" maxLength={500} rows={IS_INK ? 2 : 3} />
        </div>

        <div className="kf-field">
          <label>Token Image <i>(optional)</i></label>
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onLogoFile(f); }} />
          <div className="kf-drop-zone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) onLogoFile(f); }}>
            <div className="kf-drop-row">
              {logoData ? (
                <img src={logoData} alt="" style={{ width: 50, height: 50, borderRadius: 12, objectFit: "cover", flex: "none" }} />
              ) : null}
              <input
                type="text"
                readOnly
                value={logoData ? "Uploaded image ready" : ""}
                placeholder="Browse or drag and drop an image..."
                onFocus={() => fileRef.current?.click()}
              />
              <button type="button" className="kf-clip" aria-label="Upload image" onClick={() => fileRef.current?.click()}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m21 11.5-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8L13 4a3.7 3.7 0 0 1 5.2 5.2l-8.2 8.2a1.8 1.8 0 0 1-2.6-2.6L15 7.3" /></svg>
              </button>
            </div>
            <p className="kf-drop-hint">
              {IS_INK ? "PNG or JPG, square looks best." : "PNG or JPG. Square looks best. Browse or drag and drop an image here."}
              {logoData ? <> · <button type="button" style={{ color: "var(--color-accent-ink)", background: "none", border: 0, cursor: "pointer", padding: 0 }} onClick={() => setLogoData("")}>Remove</button></> : null}
            </p>
          </div>
        </div>

        {/* Pool pairing — WHYPE or a tokenized stock; the creator earns its fees */}
        <div className="kf-field">
          <label>Pool Pairing <i>({env.nativeSymbol} + {STOCK_PAIRS.length} tokenized stocks)</i></label>
          {IS_INK ? null : <input type="text" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${env.nativeSymbol} or an xStock (NVDAX, SPYX, TSLAX…)`} />}
          <div className="kf-pairgrid" style={IS_INK ? undefined : { maxHeight: 360, overflowY: "auto" }}>
            {filtered.map((p) => (
              <button
                type="button"
                key={p.address}
                onClick={() => setPair(p.address)}
                title={p.sub}
                className={pair === p.address ? "on" : ""}
              >
                {p.label}
              </button>
            ))}
            {filtered.length === 0 ? <div style={{ gridColumn: "1 / -1", padding: "12px 0", textAlign: "center", color: "var(--color-ink-3)" }}>No match.</div> : null}
          </div>
          {IS_INK ? null : (
            <p className="hint">
              Every trade pays 1% in {selected.label} ({selected.sub}): 50% to holders, 40% to you, 10% platform.
            </p>
          )}
          {selected.address !== WHYPE_PAIR.address ? (
            <div style={{
              marginTop: 8, border: "1px solid var(--color-edge)", background: "var(--color-panel-2)",
              borderRadius: 10, padding: "10px 12px", fontSize: 11.5, lineHeight: 1.6, color: "var(--color-ink-2)",
            }}>
              {IS_INK ? (
                <>
                  <b style={{ color: "var(--color-accent-ink)" }}>{selected.label}</b> is {selected.sub} on
                  Ink. Buyers (and your dev buy) need {selected.label} first, from{" "}
                  <a href="https://app.uniswap.org" target="_blank" rel="noreferrer"
                    style={{ color: "var(--color-accent-ink)", textDecoration: "underline" }}>
                    Uniswap on Ink
                  </a>. {env.nativeSymbol} pairs get the widest wallet and bot reach.
                </>
              ) : (
                <>
                  <b style={{ color: "var(--color-accent-ink)" }}>How buyers get {selected.label}:</b> a{" "}
                  {selected.label}-paired coin trades in {selected.label} on HyperEVM. To hold it, buy{" "}
                  {selected.label} on the{" "}
                  <a href="https://app.hyperliquid.xyz/trade" target="_blank" rel="noreferrer"
                    style={{ color: "var(--color-accent-ink)", textDecoration: "underline" }}>
                    Hyperliquid spot market
                  </a>{" "}
                  first, then transfer it to EVM (Portfolio, Transfer to EVM). Same goes for your dev buy.
                  Trading bots and most wallets only route {env.nativeSymbol} pairs, so pick{" "}
                  {env.nativeSymbol} for the widest reach.
                </>
              )}
            </div>
          ) : null}
        </div>

        {/* Dev buy: an automatic first buy sent right after the pool opens */}
        <div className={`kf-field${IS_INK ? " lf-half" : ""}`}>
          <label>Dev Buy <i>(optional, {selected.label})</i></label>
          <input
            type="text"
            inputMode="decimal"
            value={devBuy}
            onChange={(e) => setDevBuy(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="0.0"
          />
          <p className="hint">
            {IS_INK
              ? "Your own first buy, inside the launch transaction itself."
              : `${selected.label} spent buying your own coin in the launch transaction itself, before anyone else can trade${selected.address === WHYPE ? "" : ` (you need ${selected.label} in your wallet)`}.`}
          </p>
        </div>

        {IS_INK ? (
          <div className="kf-field lf-half lf-facts">
            <label>Terms</label>
            <div className="rows">
              <span><i>Supply</i><b>1,000,000,000</b></span>
              <span><i>Start mcap</i><b>&asymp; $3,000</b></span>
              <span><i>Buy fee</i><b>1% auto: 0.5 / 0.4 / 0.1</b></span>
            </div>
          </div>
        ) : null}

        <div className={`kf-field${IS_INK ? " lf-third" : ""}`}>
          <label>X URL <i>(optional)</i></label>
          <input type="text" value={form.twitter} onChange={set("twitter")} placeholder={IS_INK ? "@handle" : "https://x.com/user or @handle"} />
        </div>

        <div className={`kf-field${IS_INK ? " lf-third" : ""}`}>
          <label>Telegram <i>(optional)</i></label>
          <input type="text" value={form.telegram} onChange={set("telegram")} placeholder={IS_INK ? "@group" : "https://t.me/yourgroup or @handle"} />
        </div>

        <div className={`kf-field${IS_INK ? " lf-third" : ""}`}>
          <label>Website <i>(optional)</i></label>
          <input type="text" value={form.website} onChange={set("website")} placeholder={IS_INK ? "https://" : "https://yourproject.com"} />
        </div>

        <div className="kf-divider" />

        <div className="kf-btnrow">
          <button type="button" className="kf-cancel" onClick={() => (onCancel ? onCancel() : window.history.back())}>Cancel</button>
          <button type="submit" className="kf-submit" disabled={busy}>
            {busy ? "Confirm in wallet…" : isConnected ? "Launch coin" : "Connect & launch"}
          </button>
        </div>
        <p className="kf-footnote">
          {IS_INK ? "You pay Ink gas only. No setup needed." : "You pay HyperEVM gas. Big blocks must be enabled on your wallet."}
        </p>
      </form>
    </div>
  );
}
