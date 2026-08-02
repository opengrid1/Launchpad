import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { erc20Abi, getAddress, isAddress, keccak256, toHex, type Address } from "viem";

import { StockLogo } from "../components/StockLogo";
import { client } from "../lib/client";
import { env } from "../lib/env";
import { STOCKS } from "../lib/v4/stocks";
import { ensureSdkWallet, errorText, useWallet } from "../lib/useWallet";
import { useUi } from "../store";

const LAUNCHED_TOPIC = keccak256(toHex("Launched(address,address,address,uint16,bytes32)"));
const TOKEN_CREATED_TOPIC = keccak256(
  toHex("TokenCreated(address,address,string,string,string,uint256)"),
);

type PairMode = "stock" | "custom";

/** Clamp a typed fee to the 0-10% protocol range, rounded to whole basis
 *  points (taxBps = pct * 100), so an empty or out-of-range entry is safe. */
function clampTax(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  const clamped = Math.min(10, Math.max(0, n));
  return Math.round(clamped * 100) / 100;
}

interface ResolvedToken {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
}

/**
 * Board (Robinhood-chain) launch flow. The creator picks ONE onchain token to
 * pair against — a Robinhood tokenized stock or any onchain meme token by
 * address. That token becomes both the trading pair (buys and sells settle in
 * it) and the reward: 80% of every trade fee flows to holders in that token,
 * auto-distributed once a holder is owed $4 and claimable anytime. The
 * remaining 20% funds the platform. Supply and the starting market cap are
 * fixed protocol rules.
 */
export function LaunchBoard() {
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
  const [pairMode, setPairMode] = useState<PairMode>("stock");
  const [stock, setStock] = useState<Address>(STOCKS[0].address);
  const [stockQuery, setStockQuery] = useState("");
  const [customInput, setCustomInput] = useState("");
  const [custom, setCustom] = useState<ResolvedToken | null>(null);
  const [customState, setCustomState] = useState<"idle" | "loading" | "bad">("idle");
  const [taxPct, setTaxPct] = useState(1);
  const [busy, setBusy] = useState(false);
  const [logoData, setLogoData] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // The chosen pair token: the custom token in custom mode, else the stock.
  const pair: ResolvedToken | null =
    pairMode === "custom"
      ? custom
      : (() => {
          const s = STOCKS.find((x) => x.address === stock)!;
          return { address: s.address, symbol: s.symbol, name: s.name, decimals: 18 };
        })();

  // Filter the full stock list (94 tokens) by ticker or company name.
  const stockList = useMemo(() => {
    const q = stockQuery.trim().toLowerCase();
    if (!q) return STOCKS;
    return STOCKS.filter((s) => s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));
  }, [stockQuery]);

  const set =
    (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  // Resolve a pasted address to a real onchain ERC-20 (symbol/name/decimals).
  useEffect(() => {
    const raw = customInput.trim();
    setCustom(null);
    if (!raw) return setCustomState("idle");
    if (!isAddress(raw)) return setCustomState("bad");
    let live = true;
    setCustomState("loading");
    const addr = getAddress(raw);
    const read = (functionName: "symbol" | "name" | "decimals") =>
      client.publicClient.readContract({ address: addr, abi: erc20Abi, functionName });
    Promise.all([read("symbol"), read("name"), read("decimals")])
      .then(([symbol, name, decimals]) => {
        if (!live) return;
        setCustom({ address: addr, symbol: String(symbol), name: String(name), decimals: Number(decimals) });
        setCustomState("idle");
      })
      .catch(() => live && setCustomState("bad"));
    return () => {
      live = false;
    };
  }, [customInput]);

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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConnected) return connectFirst();
    if (!pair) {
      pushToast({ kind: "error", title: "Pick a pair token", body: "Choose a stock or paste a valid token address." });
      return;
    }
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
        // Record the pair/reward token so the token page can label rewards.
        pair: { address: pair.address, symbol: pair.symbol },
      });
      const hash = await (client as any).createToken({
        name: form.name.trim(),
        symbol: form.symbol.trim().toUpperCase(),
        metadataURI: metadata,
        stock: pair.address,
        taxBps: Math.round(taxPct * 100),
      });
      pushToast({ kind: "info", title: "Launch submitted", txHash: hash });
      const receipt = await client.publicClient.waitForTransactionReceipt({ hash });
      const log = receipt.logs.find(
        (l) => l.topics[0] === LAUNCHED_TOPIC || l.topics[0] === TOKEN_CREATED_TOPIC,
      );
      pushToast({ kind: "success", title: "Token is live", body: "Pool open, trading enabled.", txHash: hash });
      if (log?.topics[1]) navigate(`/token/0x${log.topics[1].slice(26)}`);
      else navigate("/");
    } catch (err) {
      pushToast({ kind: "error", title: "Launch failed", body: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="board mx-auto max-w-lg px-4 pb-24 pt-5 sm:px-5">
      <div className="flex items-center gap-2">
        <span className="board-dot" />
        <h1 className="text-[18px] font-extrabold tracking-tight text-ink">Print a token</h1>
      </div>
      <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">
        One transaction mints your token, opens a live market and seeds the full supply. Pick any
        onchain token to pair against; holders earn 80% of every trade fee in that token.
      </p>

      <form onSubmit={submit} className="board-form mt-4 space-y-4">
        {/* Logo + identity */}
        <div className="flex items-center gap-3">
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onLogoFile(f); }} />
          <button type="button" onClick={() => fileRef.current?.click()}
            className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl border border-edge bg-panel-2 transition-colors hover:border-accent"
            aria-label="Upload logo">
            {logoData ? (
              <img src={logoData} alt="" className="h-full w-full object-cover" />
            ) : (
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
              {logoData ? (
                <button type="button" className="font-medium text-accent-ink underline underline-offset-2" onClick={() => setLogoData("")}>Remove</button>
              ) : null}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_130px]">
          <BoardField label="Token name">
            <input className="board-input h-10 w-full px-3 text-[13px] outline-none" value={form.name} onChange={set("name")} placeholder="My Token" required maxLength={48} />
          </BoardField>
          <BoardField label="Symbol">
            <input className="board-input h-10 w-full px-3 text-[13px] outline-none" value={form.symbol} onChange={set("symbol")} placeholder="MTK" required maxLength={12} />
          </BoardField>
        </div>

        <BoardField label="Description">
          <textarea className="board-input min-h-20 w-full resize-y px-3 py-2 text-[13px] outline-none" value={form.description} onChange={set("description")}
            placeholder="What is this token about?" maxLength={500} />
        </BoardField>

        {/* Pair + reward token: one token is both the trading pair and reward. */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-[12.5px] font-semibold text-ink">
              Pair &amp; reward{pair ? <span className="text-ink-3"> · ${pair.symbol}</span> : null}
            </label>
            <div className="board-tabs board-tabs-sm">
              <button type="button" onClick={() => setPairMode("stock")} className={pairMode === "stock" ? "on" : ""}>Stocks</button>
              <button type="button" onClick={() => setPairMode("custom")} className={pairMode === "custom" ? "on" : ""}>Custom</button>
            </div>
          </div>

          {pairMode === "stock" ? (
            <div>
              <input
                value={stockQuery}
                onChange={(e) => setStockQuery(e.target.value)}
                placeholder={`Search ${STOCKS.length} stocks by ticker or name`}
                type="search"
                className="board-input mb-2 h-9 w-full px-3 text-[12.5px] outline-none"
              />
              <div className="grid max-h-56 grid-cols-4 gap-1.5 overflow-y-auto pr-0.5 sm:grid-cols-5">
                {stockList.map((s) => (
                  <button
                    type="button"
                    key={s.address}
                    onClick={() => setStock(s.address)}
                    title={`${s.name} · $${s.usd}`}
                    className={`flex flex-col items-center gap-1 rounded-xl border py-2 text-[11px] font-bold transition-colors ${
                      stock === s.address ? "border-accent bg-accent/10 text-accent-ink" : "border-edge text-ink-2 hover:border-accent/50 hover:text-ink"
                    }`}
                  >
                    <StockLogo address={s.address} symbol={s.symbol} size={22} />
                    {s.symbol}
                  </button>
                ))}
                {stockList.length === 0 && (
                  <p className="col-span-full py-6 text-center text-[12px] text-ink-3">No stock matches "{stockQuery}".</p>
                )}
              </div>
            </div>
          ) : (
            <div>
              <input
                className="board-input h-10 w-full px-3 font-mono text-[12.5px] outline-none"
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                placeholder="0x… any onchain meme token or stock"
                spellCheck={false}
              />
              <div className="mt-1.5 min-h-[18px] text-[11.5px]">
                {customState === "loading" && <span className="text-ink-3">Reading token…</span>}
                {customState === "bad" && <span className="text-down">Not a valid ERC-20 on {env.chainName}.</span>}
                {customState === "idle" && custom && (
                  <span className="text-accent-ink">
                    ✓ {custom.name} <span className="font-mono text-ink-2">${custom.symbol}</span>
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Fee mechanics: reward model */}
        <div className="rounded-xl border border-accent/25 bg-accent/[0.05] px-3 py-2.5">
          <p className="text-[12.5px] font-semibold text-ink">
            Holders earn <span className="text-accent-ink">80% of every trade fee</span>
            {pair ? <> in <span className="text-accent-ink">${pair.symbol}</span></> : null}
          </p>
          <ul className="mt-1.5 space-y-1 text-[11.5px] leading-relaxed text-ink-2">
            <li>· Your token trades against {pair ? `$${pair.symbol}` : "the token you pick"} — buys and sells settle in it.</li>
            <li>· 80% of every fee goes to holders in {pair ? `$${pair.symbol}` : "that token"}, split by how much they hold.</li>
            <li>· You (the creator) keep the other 20%. No tax on the token itself.</li>
          </ul>
        </div>

        {/* Trade fee: slider for quick set, plus a custom exact-percent field.
            Both feed the same value, clamped to the 0-10% protocol max. */}
        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <label className="text-[12.5px] font-semibold text-ink">Trade fee</label>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={0}
                max={10}
                step={0.1}
                value={taxPct}
                onChange={(e) => setTaxPct(clampTax(e.target.value))}
                aria-label="Custom trade fee percent"
                className="board-input mono h-8 w-16 px-2 text-right text-[13px] font-bold text-accent-ink outline-none"
              />
              <span className="mono text-[13px] font-bold text-ink-3">%</span>
            </div>
          </div>
          <input type="range" min={0} max={10} step={0.5} value={taxPct} onChange={(e) => setTaxPct(Number(e.target.value))}
            className="w-full accent-[color:var(--color-accent)]" />
          <p className="mt-1 text-[11px] text-ink-3">Set any fee from 0% to 10%. This is what every trade pays.</p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <BoardField label="X"><input className="board-input h-10 w-full px-3 text-[13px] outline-none" value={form.twitter} onChange={set("twitter")} placeholder="x.com/…" /></BoardField>
          <BoardField label="Telegram"><input className="board-input h-10 w-full px-3 text-[13px] outline-none" value={form.telegram} onChange={set("telegram")} placeholder="t.me/…" /></BoardField>
          <BoardField label="Website"><input className="board-input h-10 w-full px-3 text-[13px] outline-none" value={form.website} onChange={set("website")} placeholder="https://" /></BoardField>
        </div>

        <dl className="space-y-1.5 border-t border-edge pt-3 text-[12px]">
          <Row label="Starting market cap" value="$3,000" />
          <Row label="Supply" value="1,000,000,000" />
          <Row label="Trade fee" value={`${taxPct}% · 80% holders, 20% you`} />
        </dl>

        <button type="submit" disabled={busy || (pairMode === "custom" && !custom)}
          className="board-launch h-11 w-full !text-[14px] disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? "Confirm in wallet…" : isConnected ? "Print token" : "Connect wallet to print"}
        </button>
      </form>
    </div>
  );
}

function BoardField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-semibold text-ink-2">{label}</span>
      {children}
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-3">{label}</dt>
      <dd className="mono text-right font-medium text-ink-2">{value}</dd>
    </div>
  );
}
