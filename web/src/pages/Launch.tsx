import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { parseEther } from "viem";

import { Field, inputClass } from "../components/ui";
import { client } from "../lib/client";
import { env } from "../lib/env";
import { errorText, useWallet } from "../lib/useWallet";
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
    logo: "",
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

  const logoPreview = useMemo(() => {
    const v = form.logo.trim();
    if (!v) return null;
    if (v.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${v.slice(7)}`;
    if (/^https?:\/\//.test(v)) return v;
    return null;
  }, [form.logo]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConnected) return connectFirst();
    setBusy(true);
    try {
      const hash = await client.createToken({
        name: form.name.trim(),
        symbol: form.symbol.trim().toUpperCase(),
        description: form.description.trim(),
        logo: form.logo.trim(),
        website: form.website.trim(),
        twitter: form.twitter.trim(),
        telegram: form.telegram.trim(),
        firstBuyWei: form.firstBuy ? parseEther(form.firstBuy as `${number}`) : 0n,
      });
      pushToast({ kind: "info", title: "Launch submitted", txHash: hash });
      const receipt = await client.publicClient.waitForTransactionReceipt({ hash });
      const launchedLog = receipt.logs.find(
        (l) => l.address.toLowerCase() === client.addresses.launchpad.toLowerCase()
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
      <h1 className="text-[28px] font-semibold tracking-tight text-ink">Launch Token</h1>
      <p className="mt-1.5 text-sm text-ink-2">
        Launching is free. One transaction creates your token and a live Uniswap V3 market
        seeded with the full supply. Optionally make the first buy in the same transaction.
      </p>

      <form onSubmit={submit} className="mt-8 space-y-5">
        <div className="flex items-center gap-4">
          <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full border border-edge bg-panel">
            {logoPreview ? (
              <img src={logoPreview} alt="" className="h-full w-full object-cover" />
            ) : (
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" className="text-ink-3" aria-hidden>
                <rect x="2" y="2" width="18" height="18" rx="9" stroke="currentColor" strokeWidth="1.5" />
                <path d="M11 7v8M7 11h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            )}
          </div>
          <div className="flex-1">
            <Field label="Logo" hint="image URL or ipfs://">
              <input className={inputClass} value={form.logo} onChange={set("logo")} placeholder="https://..." />
            </Field>
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
            className={`${inputClass} tnum`}
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
          className="h-12 w-full rounded-full bg-accent text-[15px] font-semibold text-ink transition-colors hover:bg-accent-2 disabled:cursor-not-allowed disabled:bg-panel-2 disabled:text-ink-3"
        >
          {busy ? "Confirm in wallet" : isConnected ? "Launch Token" : "Connect Wallet to Launch"}
        </button>
      </form>
    </div>
  );
}
