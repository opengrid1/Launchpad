import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { keccak256, toHex } from "viem";

import { client } from "../lib/client";
import { BASE_STOCKS, type BaseStock } from "../lib/base/stocks";
import { BASE_USDC, BASE_WETH } from "../lib/base/routes";

// Coins can pair a tokenized stock (holders earn the stock), ETH, or USDC
// (holders earn ETH / dollars). ETH + USDC lead as the two currency pairs.
const PAIRS: BaseStock[] = [
  { symbol: "ETH", name: "Ethereum", address: BASE_WETH, usd: 1900, usdcTickSpacing: 10 },
  { symbol: "USDC", name: "US Dollar Coin", address: BASE_USDC, usd: 1, usdcTickSpacing: 10 },
  ...BASE_STOCKS,
];
import { ensureSdkWallet, errorText, useWallet } from "../lib/useWallet";
import { useUi } from "../store";

const LAUNCHED_TOPIC = keccak256(toHex("Launched(address,address,address,uint16,bytes32)"));

/**
 * Base stock launch. The creator picks a tokenized stock holders will earn,
 * uploads a logo, and sets the trade tax (1-10%). One transaction mints a
 * native B-20 coin, opens the coin/stock market at a $4,000 cap, seeds the
 * full supply single-sided, and spins up the coin's holder-reward vault. Half
 * of every trade's creator share flows to holders as that stock.
 */
export function LaunchBase() {
  const { isConnected, connectFirst } = useWallet();
  const pushToast = useUi((s) => s.pushToast);
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: "",
    symbol: "",
    description: "",
    website: "",
    twitter: "",
    telegram: "",
  });
  const [stock, setStock] = useState(PAIRS[2].address);
  const [taxPct, setTaxPct] = useState(1);
  const [busy, setBusy] = useState(false);
  const [logoData, setLogoData] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const set =
    (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  const onLogoFile = async (file: File) => {
    try {
      const bitmap = await createImageBitmap(file);
      const render = (size: number, quality: number) => {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
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

  const selected = PAIRS.find((s) => s.address === stock)!;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConnected) return connectFirst();
    setBusy(true);
    try {
      if (!(await ensureSdkWallet())) throw new Error("Wallet session expired. Reconnect and try again.");
      const url = (raw: string, platform?: "x" | "telegram") => {
        const s = raw.trim();
        if (!s) return "";
        if (s.startsWith("@") && platform) {
          return platform === "x" ? `https://x.com/${s.slice(1)}` : `https://t.me/${s.slice(1)}`;
        }
        return /^https?:\/\//i.test(s) ? s : `https://${s}`;
      };
      const metadata = JSON.stringify({
        description: form.description.trim(),
        logo: logoData,
        website: url(form.website),
        twitter: url(form.twitter, "x"),
        telegram: url(form.telegram, "telegram"),
        // Surface the reward stock so lists and the token page can badge it.
        rewardStock: selected.address,
        pair: selected.symbol,
      });
      const hash = await (client as any).createToken({
        name: form.name.trim(),
        symbol: form.symbol.trim().toUpperCase(),
        metadataURI: metadata,
        stock: selected.address,
        taxBps: Math.round(taxPct * 100),
        // Size the $4k start from the stock's snapshot USD price (8dp).
        pairUsdPrice8: BigInt(Math.round(selected.usd * 1e8)),
      });
      pushToast({ kind: "info", title: "Launch submitted", txHash: hash });
      const receipt = await client.publicClient.waitForTransactionReceipt({ hash });
      const log = receipt.logs.find((l) => l.topics[0] === LAUNCHED_TOPIC);
      pushToast({ kind: "success", title: "Coin is live", body: "Market open, holders now earn the stock.", txHash: hash });
      if (log?.topics[1]) navigate(`/token/0x${log.topics[1].slice(26)}`);
      else navigate("/");
    } catch (err) {
      pushToast({ kind: "error", title: "Launch failed", body: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="kf kf-page kf-launch" style={{ maxWidth: 640 }}>
      <h1 className="kf-launch-h1">Launch a token</h1>
      <p className="kf-launch-sub">
        Deploy a coin on {`Base`} paired with a real tokenized stock. Every trade pays holders that stock.
      </p>

      <form onSubmit={submit} className="kf-form">
        <div className="kf-field">
          <label>Token Name</label>
          <input type="text" value={form.name} onChange={set("name")} placeholder="Enter token name..." required maxLength={48} autoFocus />
        </div>

        <div className="kf-field">
          <label>Ticker Symbol <i>(optional)</i></label>
          <input type="text" value={form.symbol} onChange={set("symbol")} placeholder="e.g. TKN" maxLength={12} />
          <p className="hint">Auto-generated from the name if left blank.</p>
        </div>

        <div className="kf-field">
          <label>Token Image <i>(optional)</i></label>
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onLogoFile(f); }} />
          <div className="kf-drop-zone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) onLogoFile(f); }}>
            {logoData ? (
              <img src={logoData} alt="" style={{ width: 46, height: 46, borderRadius: 12, objectFit: "cover" }} />
            ) : null}
            <input type="text" readOnly value={logoData ? "Image ready" : ""} placeholder="Paste image URL or upload..."
              onClick={() => fileRef.current?.click()} style={{ cursor: "pointer" }} />
            <button type="button" className="kf-clip" aria-label="Upload image" onClick={() => fileRef.current?.click()}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m21 11.5-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8L13 4a3.7 3.7 0 0 1 5.2 5.2l-8.2 8.2a1.8 1.8 0 0 1-2.6-2.6L15 7.3" /></svg>
            </button>
          </div>
          <p className="hint">
            Paste an image URL, browse, or drag and drop an image here.
            {logoData ? <> · <button type="button" style={{ color: "var(--color-accent-ink)", background: "none", border: 0, cursor: "pointer", padding: 0 }} onClick={() => setLogoData("")}>Remove</button></> : null}
          </p>
        </div>

        <div className="kf-field">
          <label>Description <i>(optional)</i></label>
          <textarea value={form.description} onChange={set("description")} placeholder="What is this coin about?" maxLength={500} rows={3} />
        </div>

        {/* Reward pair picker — the koi.fun mechanic */}
        <div className="kf-field">
          <label>Holders earn <i>· {selected.symbol} ({selected.name})</i></label>
          <div className="grid grid-cols-3 gap-1.5">
            {PAIRS.map((s) => (
              <button
                type="button"
                key={s.address}
                onClick={() => setStock(s.address)}
                title={s.name}
                className="kf-pill"
                style={stock === s.address ? { boxShadow: "inset 0 0 0 1.5px #7c5cff" } : undefined}
              >
                {s.symbol}
              </button>
            ))}
          </div>
          <p className="hint">Every trade streams this asset to your holders.</p>
        </div>

        {/* Trade tax */}
        <div className="kf-field">
          <label>Trade tax <i>· {taxPct}%</i></label>
          <input type="range" min={1} max={10} step={1} value={taxPct} onChange={(e) => setTaxPct(Number(e.target.value))}
            className="w-full accent-[color:var(--color-accent)]" />
          <p className="hint">Half goes to holders as {selected.symbol}, half to you. The platform takes a small cut.</p>
        </div>

        <div className="kf-field">
          <label>X URL <i>(optional)</i></label>
          <input type="text" value={form.twitter} onChange={set("twitter")} placeholder="https://x.com/user/status/..." />
        </div>

        <div className="kf-field">
          <label>Website <i>(optional)</i></label>
          <input type="text" value={form.website} onChange={set("website")} placeholder="https://yourproject.com" />
        </div>

        <div className="kf-field">
          <label>Telegram <i>(optional)</i></label>
          <input type="text" value={form.telegram} onChange={set("telegram")} placeholder="https://t.me/..." />
        </div>

        <div className="kf-field" style={{ borderTop: "1px solid var(--color-edge)", paddingTop: 14 }}>
          <p className="hint" style={{ marginTop: 0 }}>Starting market cap $4,000 · Supply 1,000,000,000 · Holder reward {selected.symbol} (50% of the tax)</p>
        </div>

        <button type="submit" className="kf-submit" disabled={busy}>
          {busy ? "Confirm in wallet…" : isConnected ? "Launch token" : "Connect wallet to launch"}
        </button>
      </form>
    </div>
  );
}
