import { useEffect, useState } from "react";

import { client } from "../lib/client";
import { StableV3Client } from "../lib/stable/client";
import { shortAddr } from "../lib/format";
import { ensureSdkWallet, errorText, useWallet } from "../lib/useWallet";
import { useUi } from "../store";

const stable = client as unknown as StableV3Client;

/**
 * Operations console for the StableLaunchpadFactory owner. Access is enforced
 * on-chain by Ownable: any other wallet reads a 403 and can call nothing.
 */
export function AdminStable() {
  const { address, isConnected, connectFirst } = useWallet();
  const pushToast = useUi((s) => s.pushToast);

  const [info, setInfo] = useState<Awaited<ReturnType<StableV3Client["adminInfo"]>> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [newRecipient, setNewRecipient] = useState("");
  const [tokenAddr, setTokenAddr] = useState("");
  const [recoverAsset, setRecoverAsset] = useState("");
  const [recoverAmount, setRecoverAmount] = useState("");

  const refresh = () => stable.adminInfo().then(setInfo).catch(() => setInfo(null));
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isOwner = Boolean(info && address && info.owner.toLowerCase() === address.toLowerCase());

  const run = async (label: string, fn: () => Promise<`0x${string}`>) => {
    setBusy(label);
    try {
      if (!(await ensureSdkWallet())) throw new Error("Wallet session expired. Reconnect and try again.");
      const hash = await fn();
      pushToast({ kind: "info", title: `${label} submitted`, txHash: hash });
      await stable.publicClient.waitForTransactionReceipt({ hash });
      pushToast({ kind: "success", title: `${label} confirmed`, txHash: hash });
      refresh();
    } catch (err) {
      pushToast({ kind: "error", title: `${label} failed`, body: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  if (!isConnected) {
    return (
      <Shell>
        <p className="text-[13.5px] text-ink-2">Connect the factory owner wallet to continue.</p>
        <button onClick={connectFirst} className="mt-4 rounded-lg bg-accent px-5 py-2.5 text-[13.5px] font-semibold text-accent-fg">
          Connect wallet
        </button>
      </Shell>
    );
  }

  if (info && !isOwner) {
    return (
      <Shell>
        <p className="text-[15px] font-bold text-ink">403</p>
        <p className="mt-1 text-[13px] text-ink-2">
          This console is restricted to the factory owner ({shortAddr(info.owner)}). Connected:{" "}
          {address ? shortAddr(address) : "—"}.
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      {/* Overview */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Tokens launched" value={info ? String(info.tokenCount) : "…"} />
        <Stat label="Launches" value={info ? (info.paused ? "PAUSED" : "LIVE") : "…"} accent={!info?.paused} />
        <Stat label="Fee recipient" value={info ? shortAddr(info.feeRecipient) : "…"} mono />
        <Stat label="Owner" value={info ? shortAddr(info.owner) : "…"} mono />
      </div>

      {/* Launch switch */}
      <Section title="Launches">
        <button
          disabled={busy !== null || !info}
          onClick={() => run(info?.paused ? "Resume launches" : "Pause launches", () => stable.adminCall(info?.paused ? "resume" : "pause"))}
          className={`rounded-lg px-4 py-2 text-[13px] font-semibold ${info?.paused ? "bg-accent text-accent-fg" : "border border-down/40 bg-down/10 text-down"}`}
        >
          {busy ? "Working…" : info?.paused ? "Resume launches" : "Pause launches"}
        </button>
      </Section>

      {/* Fee recipient */}
      <Section title="Platform fee recipient">
        <div className="flex gap-2">
          <input value={newRecipient} onChange={(e) => setNewRecipient(e.target.value)} placeholder="0x…"
            className="mono h-10 flex-1 rounded-lg border border-edge bg-panel-2/40 px-3 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-edge-2" />
          <button disabled={busy !== null || !/^0x[0-9a-fA-F]{40}$/.test(newRecipient)}
            onClick={() => run("Set fee recipient", () => stable.adminCall("setFeeRecipient", [newRecipient]))}
            className="rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-accent-fg disabled:opacity-40">
            Update
          </button>
        </div>
      </Section>

      {/* Token operations */}
      <Section title="Token position" hint="harvestFees splits accrued pool fees 80/20 creator/platform. collectFees unwinds the entire position to the owner — irreversible for that market's liquidity.">
        <input value={tokenAddr} onChange={(e) => setTokenAddr(e.target.value)} placeholder="Token address 0x…"
          className="mono h-10 w-full rounded-lg border border-edge bg-panel-2/40 px-3 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-edge-2" />
        <div className="mt-2 flex gap-2">
          <button disabled={busy !== null || !/^0x[0-9a-fA-F]{40}$/.test(tokenAddr)}
            onClick={() => run("Harvest fees", () => stable.adminCall("harvestFees", [tokenAddr]))}
            className="rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-accent-fg disabled:opacity-40">
            Harvest fees (80/20)
          </button>
          <button disabled={busy !== null || !/^0x[0-9a-fA-F]{40}$/.test(tokenAddr)}
            onClick={() => {
              if (window.confirm("Unwind ALL liquidity for this token to the owner wallet? This empties the market's position.")) {
                run("Collect position", () => stable.adminCall("collectFees", [tokenAddr]));
              }
            }}
            className="rounded-lg border border-down/40 bg-down/10 px-4 py-2 text-[13px] font-semibold text-down disabled:opacity-40">
            Collect position → owner
          </button>
        </div>
      </Section>

      {/* Recovery */}
      <Section title="Recovery" hint="For assets sent to the factory by mistake. Amount is raw wei/units of the asset.">
        <div className="flex flex-wrap gap-2">
          <input value={recoverAsset} onChange={(e) => setRecoverAsset(e.target.value)} placeholder="ERC20 address 0x…"
            className="mono h-10 flex-1 basis-64 rounded-lg border border-edge bg-panel-2/40 px-3 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-edge-2" />
          <input value={recoverAmount} onChange={(e) => setRecoverAmount(e.target.value.replace(/[^0-9]/g, ""))} placeholder="amount (wei)"
            className="mono h-10 w-40 rounded-lg border border-edge bg-panel-2/40 px-3 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-edge-2" />
          <button disabled={busy !== null || !/^0x[0-9a-fA-F]{40}$/.test(recoverAsset) || !recoverAmount}
            onClick={() => run("Recover ERC20", () => stable.adminCall("recoverERC20", [recoverAsset, BigInt(recoverAmount)]))}
            className="rounded-lg border border-edge bg-panel px-4 py-2 text-[13px] font-semibold text-ink disabled:opacity-40">
            Recover ERC20
          </button>
          <button disabled={busy !== null}
            onClick={() => run("Recover native", () => stable.adminCall("recoverNative"))}
            className="rounded-lg border border-edge bg-panel px-4 py-2 text-[13px] font-semibold text-ink disabled:opacity-40">
            Recover native
          </button>
        </div>
      </Section>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-5">
      <h1 className="text-[18px] font-bold tracking-tight text-ink">Operations</h1>
      <p className="mt-1 text-[12.5px] text-ink-2">StableLaunchpadFactory owner console — Stable Mainnet.</p>
      <div className="mt-5 space-y-5">{children}</div>
    </div>
  );
}

function Stat({ label, value, mono, accent }: { label: string; value: string; mono?: boolean; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-edge bg-panel p-3">
      <p className="text-[9.5px] uppercase tracking-wide text-ink-3">{label}</p>
      <p className={`mt-0.5 text-[13.5px] font-bold ${accent ? "text-accent-ink" : "text-ink"} ${mono ? "mono" : ""}`}>{value}</p>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-edge bg-panel p-4">
      <h2 className="text-[13.5px] font-bold text-ink">{title}</h2>
      {hint ? <p className="mb-3 mt-1 text-[11.5px] leading-relaxed text-ink-3">{hint}</p> : <div className="mb-3" />}
      {children}
    </div>
  );
}
