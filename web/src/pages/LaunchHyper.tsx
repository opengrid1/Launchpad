import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { keccak256, toHex } from "viem";

import { client } from "../lib/client";
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
export function LaunchHyper() {
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
    <div className="mx-auto max-w-lg px-4 pb-16 pt-5 sm:px-5">
      <h1 className="text-[18px] font-bold tracking-tight text-ink">Launch a coin</h1>
      <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">
        One transaction mints your coin, opens a live HyperSwap market and seeds the full supply. Every trade pays
        <span className="text-accent-ink"> you, the creator, 1% forever</span>.
      </p>

      {/* Big-blocks notice — a launch deploys a V3 pool (~6M gas), above HyperEVM's small-block limit. */}
      <div className="mt-3 rounded-xl border border-edge bg-panel-2 p-3 text-[11.5px] leading-relaxed text-ink-2">
        <span className="font-semibold text-accent-ink">One-time setup:</span> launching deploys a pool, which needs
        HyperEVM <b>big blocks</b> enabled on your wallet. Turn on “Use big blocks for EVM” in the{" "}
        <a href="https://app.hyperliquid.xyz" target="_blank" rel="noreferrer" className="text-accent-ink underline underline-offset-2">Hyperliquid app</a>{" "}
        once, then launch here. Trading your coin afterward needs nothing special.
      </div>

      <form onSubmit={submit} className="mt-4 space-y-4 rounded-xl border border-edge bg-panel p-4">
        {/* Logo + identity */}
        <div className="flex items-center gap-3">
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onLogoFile(f); }} />
          <button type="button" onClick={() => fileRef.current?.click()}
            className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-lg border border-edge bg-panel-2 transition-colors hover:border-edge-2"
            aria-label="Upload logo">
            {logoData ? <img src={logoData} alt="" className="h-full w-full object-cover" /> : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-ink-3" aria-hidden>
                <path d="M12 16V5m0 0l-4 4m4-4l4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M4 17.5V19a1.5 1.5 0 001.5 1.5h13A1.5 1.5 0 0020 19v-1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            )}
          </button>
          <div>
            <p className="text-[13px] font-semibold text-ink">Logo</p>
            <p className="mt-0.5 text-[11.5px] text-ink-3">
              PNG / JPG.{" "}
              {logoData ? <button type="button" className="font-medium text-accent-ink underline underline-offset-2" onClick={() => setLogoData("")}>Remove</button> : "Square looks best."}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[12px] font-medium text-ink-2">Name</span>
            <input value={form.name} onChange={set("name")} placeholder="My Coin" maxLength={48}
              className={`mt-1 w-full rounded-lg border bg-panel-2 px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3 ${nameError ? "border-down" : "border-edge focus:border-edge-2"}`} />
          </label>
          <label className="block">
            <span className="text-[12px] font-medium text-ink-2">Ticker <i className="text-ink-3">(optional)</i></span>
            <input value={form.symbol} onChange={set("symbol")} placeholder="COIN" maxLength={12}
              className="mt-1 w-full rounded-lg border border-edge bg-panel-2 px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-edge-2" />
          </label>
        </div>
        {nameError ? <p className="text-[11.5px] text-down">{nameError}</p> : null}

        <label className="block">
          <span className="text-[12px] font-medium text-ink-2">Description <i className="text-ink-3">(optional)</i></span>
          <textarea value={form.description} onChange={set("description")} placeholder="What is this coin about?" maxLength={500} rows={3}
            className="mt-1 w-full resize-none rounded-lg border border-edge bg-panel-2 px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-edge-2" />
        </label>

        {/* Pair picker — WHYPE or a tokenized stock; the creator earns fees in it */}
        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-[12px] font-medium text-ink-2">Pair</span>
            <span className="text-[11px] text-ink-3">You earn 1% of every trade in {selected.label}</span>
          </div>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search HYPE or a stock (NVDA, TSLA, SPY…)"
            className="mt-1 w-full rounded-lg border border-edge bg-panel-2 px-3 py-2 text-[12.5px] text-ink outline-none placeholder:text-ink-3 focus:border-edge-2" />
          <div className="mt-2 grid max-h-44 grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4">
            {filtered.map((p) => (
              <button type="button" key={p.address} onClick={() => setPair(p.address)} title={p.sub}
                className={`rounded-lg border px-2 py-2 text-left transition-colors ${pair === p.address ? "border-accent bg-panel-2" : "border-edge bg-panel hover:border-edge-2"}`}>
                <div className="text-[12.5px] font-semibold text-ink">{p.label}</div>
                <div className="truncate text-[10.5px] text-ink-3">{p.sub}</div>
              </button>
            ))}
            {filtered.length === 0 ? <div className="col-span-full py-3 text-center text-[11.5px] text-ink-3">No match.</div> : null}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block"><span className="text-[12px] font-medium text-ink-2">Website</span>
            <input value={form.website} onChange={set("website")} placeholder="yoursite.com" className="mt-1 w-full rounded-lg border border-edge bg-panel-2 px-3 py-2 text-[12.5px] text-ink outline-none placeholder:text-ink-3 focus:border-edge-2" /></label>
          <label className="block"><span className="text-[12px] font-medium text-ink-2">X</span>
            <input value={form.twitter} onChange={set("twitter")} placeholder="@handle" className="mt-1 w-full rounded-lg border border-edge bg-panel-2 px-3 py-2 text-[12.5px] text-ink outline-none placeholder:text-ink-3 focus:border-edge-2" /></label>
          <label className="block"><span className="text-[12px] font-medium text-ink-2">Telegram</span>
            <input value={form.telegram} onChange={set("telegram")} placeholder="@group" className="mt-1 w-full rounded-lg border border-edge bg-panel-2 px-3 py-2 text-[12.5px] text-ink outline-none placeholder:text-ink-3 focus:border-edge-2" /></label>
        </div>

        <button type="submit" disabled={busy}
          className="w-full rounded-lg bg-accent px-4 py-3 text-[14px] font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-60">
          {busy ? "Confirm in wallet…" : isConnected ? "Launch coin" : "Connect & launch"}
        </button>
        <p className="text-center text-[11px] text-ink-3">You pay HyperEVM gas. Big blocks must be enabled on your wallet.</p>
      </form>
    </div>
  );
}
