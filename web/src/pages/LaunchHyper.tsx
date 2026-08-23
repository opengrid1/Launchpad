import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { keccak256, toHex } from "viem";

import { client } from "../lib/client";
import { env } from "../lib/env";
import { HYPER_STOCKS, WHYPE, type HyperStock } from "../lib/hyper/stocks";
import { ensureSdkWallet, errorText, useWallet } from "../lib/useWallet";
import { useUi } from "../store";

const TOKEN_CREATED_TOPIC = keccak256(
  toHex("TokenCreated(address,address,string,string,string,uint256)"),
);

// The launch pair options: WHYPE (default) plus every tokenized stock live on
// HyperEVM. The creator earns the pool's 1% fee in whichever they pick.
type Pair = { symbol: string; label: string; sub: string; address: `0x${string}` };
const WHYPE_PAIR: Pair = { symbol: "HYPE", label: "HYPE", sub: "Hyperliquid", address: WHYPE };
const STOCK_PAIRS: Pair[] = HYPER_STOCKS.map((s: HyperStock) => ({
  symbol: s.ticker,
  label: s.ticker,
  sub: s.name,
  address: s.address,
}));
const ALL_PAIRS: Pair[] = [WHYPE_PAIR, ...STOCK_PAIRS];

/**
 * liquidstock launch (HyperEVM / HyperSwap V3). One transaction mints a plain
 * ERC-20, opens its HyperSwap pool paired with the chosen asset, and seeds the
 * full supply single-sided. The pool's 1% fee accrues to the creator forever.
 */
export function LaunchHyper({ onCancel }: { onCancel?: () => void } = {}) {
  const { isConnected, connectFirst } = useWallet();
  const pushToast = useUi((s) => s.pushToast);
  const navigate = useNavigate();

  const [form, setForm] = useState({ name: "", symbol: "", description: "", website: "", twitter: "", telegram: "" });
  const [pair, setPair] = useState<`0x${string}`>(WHYPE);
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
      const hash = await (client as any).createToken({
        name: form.name.trim(),
        symbol: (form.symbol.trim() || form.name.trim().replace(/[^a-zA-Z0-9]/g, "").slice(0, 6) || "TOKEN").toUpperCase(),
        metadataURI: metadata,
        quote: pair,
      });
      pushToast({ kind: "info", title: "Launch submitted", txHash: hash });
      const receipt = await client.publicClient.waitForTransactionReceipt({ hash });
      const log = receipt.logs.find((l) => l.topics[0] === TOKEN_CREATED_TOPIC);
      pushToast({ kind: "success", title: "Coin is live", body: `Market open, paired with ${selected.label}.`, txHash: hash });
      if (log?.topics[1]) navigate(`/token/0x${log.topics[1].slice(26)}`);
      else navigate("/");
    } catch (err) {
      pushToast({ kind: "error", title: "Launch failed", body: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="kf kf-page kf-launch">
      <h1 className="kf-launch-h1">Launch a coin</h1>
      <p className="kf-launch-sub">
        Deploy a coin on HyperEVM paired with {env.nativeSymbol} or a tokenized stock. One transaction opens a live
        HyperSwap market and seeds the full supply. Every trade pays you, the creator, 1% forever.
      </p>

      {/* Big-blocks notice — a launch deploys a V3 pool (~6M gas), above HyperEVM's small-block limit. */}
      <div style={{
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
        <a href="https://app.hyperliquid.xyz" target="_blank" rel="noreferrer" style={{ color: "var(--color-accent-ink)", textDecoration: "underline" }}>Hyperliquid app</a>{" "}
        once, then launch here. Trading your coin afterward needs nothing special.
      </div>

      <form onSubmit={submit} className="kf-form">
        <div className="kf-field">
          <label>Token Name</label>
          <input type="text" value={form.name} onChange={set("name")} placeholder="Enter token name..." maxLength={48}
            className={nameError ? "err" : undefined} aria-invalid={!!nameError} />
          {nameError ? <p className="kf-err-msg">{nameError}</p> : null}
        </div>

        <div className="kf-field">
          <label>Ticker Symbol <i>(optional)</i></label>
          <input type="text" value={form.symbol} onChange={set("symbol")} placeholder="e.g. COIN" maxLength={12} />
          <p className="hint">Auto-generated from the name if left blank.</p>
        </div>

        <div className="kf-field">
          <label>Description <i>(optional)</i></label>
          <textarea value={form.description} onChange={set("description")} placeholder="What is this coin about?" maxLength={500} rows={3} />
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
              PNG or JPG. Square looks best. Browse or drag and drop an image here.
              {logoData ? <> · <button type="button" style={{ color: "var(--color-accent-ink)", background: "none", border: 0, cursor: "pointer", padding: 0 }} onClick={() => setLogoData("")}>Remove</button></> : null}
            </p>
          </div>
        </div>

        {/* Pool pairing — WHYPE or a tokenized stock; the creator earns its fees */}
        <div className="kf-field">
          <label>Pool Pairing</label>
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${env.nativeSymbol} or a stock (NVDA, TSLA, SPY…)`} />
          <div className="kf-pairgrid" style={{ maxHeight: 200, overflowY: "auto" }}>
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
          <p className="hint">You earn 1% of every trade in {selected.label} ({selected.sub}).</p>
        </div>

        <div className="kf-field">
          <label>X URL <i>(optional)</i></label>
          <input type="text" value={form.twitter} onChange={set("twitter")} placeholder="https://x.com/user or @handle" />
        </div>

        <div className="kf-field">
          <label>Telegram <i>(optional)</i></label>
          <input type="text" value={form.telegram} onChange={set("telegram")} placeholder="https://t.me/yourgroup or @handle" />
        </div>

        <div className="kf-field">
          <label>Website <i>(optional)</i></label>
          <input type="text" value={form.website} onChange={set("website")} placeholder="https://yourproject.com" />
        </div>

        <div className="kf-divider" />

        <div className="kf-btnrow">
          <button type="button" className="kf-cancel" onClick={() => (onCancel ? onCancel() : window.history.back())}>Cancel</button>
          <button type="submit" className="kf-submit" disabled={busy}>
            {busy ? "Confirm in wallet…" : isConnected ? "Launch coin" : "Connect & launch"}
          </button>
        </div>
        <p className="kf-footnote">You pay HyperEVM gas. Big blocks must be enabled on your wallet.</p>
      </form>
    </div>
  );
}
