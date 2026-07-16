import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { parseEther } from "viem";

import { Field, inputClass } from "../components/ui";
import { client } from "../lib/client";
import { env } from "../lib/env";
import { ensureSdkWallet, errorText, useWallet } from "../lib/useWallet";
import { useUi } from "../store";

/**
 * Single-step launch flow. Supply, trading fee, fee routing and anti-whale
 * protection are fixed protocol rules and never surface as options.
 */
export function LaunchPage() {
  const { isConnected, connectFirst } = useWallet();
  const pushToast = useUi((s) => s.pushToast);
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: "",
    symbol: "",
    description: "",
    twitter: "",
    telegram: "",
    website: "",
    firstBuy: "",
  });
  const [busy, setBusy] = useState(false);

  const set =
    (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  const [logoData, setLogoData] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Compress the picked image client-side into a small data URI that is
  // stored inside the token's on-chain metadata. 96px cover crop, quality
  // stepped down until it fits comfortably in calldata.
  const onLogoFile = async (file: File) => {
    try {
      const bitmap = await createImageBitmap(file);
      const render = (size: number, quality: number) => {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d")!;
        const side = Math.min(bitmap.width, bitmap.height);
        ctx.drawImage(
          bitmap,
          (bitmap.width - side) / 2,
          (bitmap.height - side) / 2,
          side,
          side,
          0,
          0,
          size,
          size
        );
        const webp = canvas.toDataURL("image/webp", quality);
        return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", quality);
      };
      let out = render(96, 0.8);
      if (out.length > 12_000) out = render(96, 0.55);
      if (out.length > 12_000) out = render(64, 0.55);
      setLogoData(out);
    } catch {
      pushToast({ kind: "error", title: "Could not read that image", body: "Try a PNG or JPG file." });
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConnected) return connectFirst();
    setBusy(true);
    try {
      if (!(await ensureSdkWallet())) {
        throw new Error("Wallet session expired. Reconnect your wallet and try again.");
      }
      const hash = await client.createToken({
        name: form.name.trim(),
        symbol: form.symbol.trim().toUpperCase(),
        description: form.description.trim(),
        logo: logoData,
        website: form.website.trim(),
        twitter: form.twitter.trim(),
        telegram: form.telegram.trim(),
        firstBuyWei: form.firstBuy ? parseEther(form.firstBuy as `${number}`) : 0n,
      });
      pushToast({ kind: "info", title: "Launch submitted", txHash: hash });
      const receipt = await client.publicClient.waitForTransactionReceipt({ hash });
      const launchedLog = receipt.logs.find(
        (l) => l.address.toLowerCase() === client.addresses.factory.toLowerCase()
      );
      pushToast({ kind: "success", title: "Token is live", body: "Pool created, trading open.", txHash: hash });
      if (launchedLog?.topics[1]) {
        navigate(`/token/0x${launchedLog.topics[1].slice(26)}`);
      } else {
        navigate("/");
      }
    } catch (err) {
      pushToast({ kind: "error", title: "Launch failed", body: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl px-4 py-8 sm:px-6">
      <div className="mono mb-1 flex items-center gap-2 text-[11px] uppercase tracking-wide text-accent">
        <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-accent" />
        New market
      </div>
      <h1 className="text-[26px] font-bold tracking-tight text-ink">Launch Token</h1>
      <p className="mt-1.5 text-sm text-ink-2">
        Launching is free. One transaction creates your token and a live Uniswap V3 market
        seeded with the full supply. Optionally make the first buy in the same transaction.
      </p>

      <form onSubmit={submit} className="mt-7 space-y-5 rounded-xl border border-edge bg-panel p-5">
        <div className="flex items-center gap-4">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onLogoFile(f);
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="group relative grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-full border border-edge bg-panel transition-colors hover:border-edge-2"
            aria-label="Upload logo"
          >
            {logoData ? (
              <img src={logoData} alt="" className="h-full w-full object-cover" />
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-ink-3" aria-hidden>
                <path d="M12 16V5m0 0l-4 4m4-4l4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M4 17.5V19a1.5 1.5 0 001.5 1.5h13A1.5 1.5 0 0020 19v-1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            )}
          </button>
          <div>
            <p className="text-[13px] font-medium text-ink">Upload Logo</p>
            <p className="mt-0.5 text-xs text-ink-3">
              PNG or JPG. Stored on-chain with your token.{" "}
              {logoData ? (
                <button type="button" className="underline underline-offset-2" onClick={() => setLogoData("")}>
                  Remove
                </button>
              ) : null}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-[1fr_140px]">
          <Field label="Token Name">
            <input className={inputClass} value={form.name} onChange={set("name")} placeholder="My Token" required maxLength={48} />
          </Field>
          <Field label="Symbol">
            <input className={inputClass} value={form.symbol} onChange={set("symbol")} placeholder="MTK" required maxLength={12} />
          </Field>
        </div>

        <Field label="Description">
          <textarea
            className={`${inputClass} min-h-24 resize-y`}
            value={form.description}
            onChange={set("description")}
            placeholder="What is this token about?"
            maxLength={500}
          />
        </Field>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <Field label="Twitter / X">
            <input className={inputClass} value={form.twitter} onChange={set("twitter")} placeholder="x.com/..." />
          </Field>
          <Field label="Telegram">
            <input className={inputClass} value={form.telegram} onChange={set("telegram")} placeholder="t.me/..." />
          </Field>
          <Field label="Website">
            <input className={inputClass} value={form.website} onChange={set("website")} placeholder="https://" />
          </Field>
        </div>

        <Field label="Initial Liquidity (optional)" hint={`${env.nativeSymbol}, executes your first buy`}>
          <input
            className={`${inputClass} mono`}
            value={form.firstBuy}
            onChange={set("firstBuy")}
            inputMode="decimal"
            placeholder="0.0"
          />
        </Field>

        <dl className="space-y-3 border-y border-edge py-4">
          <div className="flex items-baseline justify-between">
            <dt className="text-sm text-ink-2">Starting Market Cap</dt>
            <dd className="text-sm font-semibold text-ink">$2,000</dd>
          </div>
          <div className="flex items-baseline justify-between">
            <dt className="text-sm text-ink-2">Trading Fee</dt>
            <dd className="text-sm font-semibold text-ink">1% Fixed</dd>
          </div>
          <div className="flex items-baseline justify-between gap-6">
            <dt className="shrink-0 text-sm text-ink-2">Protection</dt>
            <dd className="text-right text-sm font-medium text-ink">
              Max transaction enabled
              <span className="block text-xs font-normal text-ink-3">Until $40,000 market cap</span>
            </dd>
          </div>
        </dl>

        <button
          type="submit"
          disabled={busy}
          className="h-12 w-full rounded-lg bg-accent text-[15px] font-bold text-black transition-colors hover:bg-accent-2 disabled:cursor-not-allowed disabled:bg-panel-2 disabled:text-ink-3"
        >
          {busy ? "Confirm in wallet" : isConnected ? "Launch Token" : "Connect Wallet to Launch"}
        </button>
      </form>
    </div>
  );
}
