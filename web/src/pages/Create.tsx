import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { parseEther } from "viem";

import { Button, Card, CardHeader, Field, inputClass } from "../components/ui";
import { client } from "../lib/client";
import { env } from "../lib/env";
import { errorText, useWallet } from "../lib/useWallet";
import { useUi } from "../store";

export function CreatePage() {
  const { isConnected, connectFirst } = useWallet();
  const pushToast = useUi((s) => s.pushToast);
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: "",
    symbol: "",
    description: "",
    logo: "",
    website: "",
    twitter: "",
    telegram: "",
    supply: "1000000000",
    feeTier: "3000",
    maxTxBps: "100",
    maxWalletBps: "200",
    cooldown: "0",
    liquidity: "0.1",
  });
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

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
        totalSupply: BigInt(form.supply) * 10n ** 18n,
        feeTier: Number(form.feeTier) as 500 | 3000 | 10000,
        maxTxBps: Number(form.maxTxBps),
        maxWalletBps: Number(form.maxWalletBps),
        buyCooldownSeconds: Number(form.cooldown),
        initialLiquidityWei: parseEther(form.liquidity as `${number}`),
      });
      pushToast({ kind: "info", title: "Launch submitted", txHash: hash });
      const receipt = await client.publicClient.waitForTransactionReceipt({ hash });
      // The token address is the first indexed arg of TokenLaunched.
      const launchedTopic = receipt.logs.find((l) => l.address.toLowerCase() === client.addresses.launchpad.toLowerCase());
      pushToast({ kind: "success", title: "Token is live", body: "Pool created and trading enabled.", txHash: hash });
      if (launchedTopic?.topics[1]) {
        navigate(`/t/0x${launchedTopic.topics[1].slice(26)}`);
      } else {
        navigate("/");
      }
    } catch (err) {
      pushToast({ kind: "error", title: "Launch failed", body: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  const supplyNum = Number(form.supply || 0);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Launch a token</h1>
      <p className="mt-1 max-w-xl text-sm leading-6 text-ink-2">
        One transaction deploys your ERC-20, creates a Uniswap V3 pool, seeds it with your full
        supply against your initial liquidity, and opens trading immediately. Nothing is simulated.
      </p>

      <form onSubmit={submit} className="mt-6 space-y-4">
        <Card>
          <CardHeader title="Token identity" />
          <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
            <Field label="Name">
              <input className={inputClass} value={form.name} onChange={set("name")} placeholder="My Token" required maxLength={48} />
            </Field>
            <Field label="Symbol">
              <input className={inputClass} value={form.symbol} onChange={set("symbol")} placeholder="MTK" required maxLength={12} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Description">
                <textarea
                  className={`${inputClass} min-h-20 resize-y`}
                  value={form.description}
                  onChange={set("description")}
                  placeholder="What is this token about?"
                  maxLength={500}
                />
              </Field>
            </div>
            <Field label="Logo URL" hint="https or ipfs">
              <input className={inputClass} value={form.logo} onChange={set("logo")} placeholder="ipfs://... or https://..." />
            </Field>
            <Field label="Website">
              <input className={inputClass} value={form.website} onChange={set("website")} placeholder="https://" />
            </Field>
            <Field label="X (Twitter)">
              <input className={inputClass} value={form.twitter} onChange={set("twitter")} placeholder="https://x.com/..." />
            </Field>
            <Field label="Telegram">
              <input className={inputClass} value={form.telegram} onChange={set("telegram")} placeholder="https://t.me/..." />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Economics" />
          <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-3">
            <Field label="Total supply" hint="whole tokens">
              <input className={inputClass} value={form.supply} onChange={set("supply")} inputMode="numeric" pattern="[0-9]*" required />
            </Field>
            <Field label="Pool fee tier">
              <select className={inputClass} value={form.feeTier} onChange={set("feeTier")}>
                <option value="500">0.05%</option>
                <option value="3000">0.30%</option>
                <option value="10000">1.00%</option>
              </select>
            </Field>
            <Field label={`Initial liquidity (${env.nativeSymbol})`} hint="paired with full supply">
              <input className={inputClass} value={form.liquidity} onChange={set("liquidity")} inputMode="decimal" required />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Anti-whale protection" right={<span className="text-[11px] text-ink-3">active until 40,000 USD market cap</span>} />
          <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-3">
            <Field label="Max transaction" hint={bpsHint(form.maxTxBps, supplyNum)}>
              <select className={inputClass} value={form.maxTxBps} onChange={set("maxTxBps")}>
                <option value="50">0.5% of supply</option>
                <option value="100">1% of supply</option>
                <option value="200">2% of supply</option>
                <option value="500">5% of supply</option>
                <option value="1000">10% of supply</option>
              </select>
            </Field>
            <Field label="Max wallet" hint={bpsHint(form.maxWalletBps, supplyNum)}>
              <select className={inputClass} value={form.maxWalletBps} onChange={set("maxWalletBps")}>
                <option value="100">1% of supply</option>
                <option value="200">2% of supply</option>
                <option value="300">3% of supply</option>
                <option value="500">5% of supply</option>
                <option value="1000">10% of supply</option>
              </select>
            </Field>
            <Field label="Buy cooldown">
              <select className={inputClass} value={form.cooldown} onChange={set("cooldown")}>
                <option value="0">None</option>
                <option value="15">15 seconds</option>
                <option value="30">30 seconds</option>
                <option value="60">60 seconds</option>
              </select>
            </Field>
          </div>
          <p className="border-t border-edge px-4 py-3 text-[11px] leading-4 text-ink-3">
            Limits are enforced by the token contract itself and lift automatically, permanently and
            without any admin involvement once the market cap crosses the threshold. Max wallet must
            be at least the max transaction.
          </p>
        </Card>

        <div className="flex items-center justify-between rounded-xl border border-edge bg-panel px-4 py-3">
          <div className="text-xs text-ink-2">
            <p className="font-medium text-ink">Launch cost: {form.liquidity || "0"} {env.nativeSymbol} + gas</p>
            <p className="mt-0.5 text-ink-3">Your entire {env.nativeSymbol} goes into the pool as trading liquidity.</p>
          </div>
          <Button type="submit" disabled={busy} className="whitespace-nowrap py-2.5">
            {busy ? "Confirm in wallet" : isConnected ? "Launch token" : "Connect wallet"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function bpsHint(bps: string, supply: number): string {
  const n = (supply * Number(bps)) / 10000;
  return n > 0 ? `${n.toLocaleString("en-US", { maximumFractionDigits: 0 })} tokens` : "";
}
