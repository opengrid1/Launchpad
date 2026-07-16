import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTokens } from "@launchpad/sdk/react";
import type { Address, TokenSummary } from "@launchpad/sdk";

import { Button } from "../components/ui";
import { client, v4Client } from "../lib/client";
import { fmtTokens } from "../lib/format";
import { tokenAbi } from "../lib/v4/abis";
import { stockOf } from "../lib/v4/stocks";
import { ensureSdkWallet, errorText, useWallet } from "../lib/useWallet";
import { useUi } from "../store";

interface Reward {
  t: TokenSummary;
  stockSym: string;
  pending: bigint;
}

/** Tokenized-stock rewards the connected wallet has earned across every market
 *  it holds, claimable per position. */
export function MyRewardsPage() {
  const { address, isConnected, connectFirst } = useWallet();
  const { data: tokens } = useTokens(client, { sort: "new", limit: 60 });
  const pushToast = useUi((s) => s.pushToast);
  const [rewards, setRewards] = useState<Reward[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useMemo(
    () => async () => {
      if (!isConnected || !address || !tokens || tokens.length === 0) return setRewards([]);
      const calls = tokens.map((t) => ({ address: t.address as Address, abi: tokenAbi, functionName: "pendingRewards", args: [address] }));
      const res = (await v4Client.publicClient.multicall({ allowFailure: true, contracts: calls as any })) as any[];
      const list: Reward[] = [];
      tokens.forEach((t, i) => {
        const pending = res[i]?.status === "success" ? (res[i].result as bigint) : 0n;
        const stock = stockOf((t.metadata as any)?.rewardStock);
        if (pending > 0n && stock) list.push({ t, stockSym: stock.symbol, pending });
      });
      list.sort((a, b) => Number(b.pending - a.pending));
      setRewards(list);
    },
    [isConnected, address, tokens],
  );

  useEffect(() => {
    load();
    const id = setInterval(load, 20_000);
    return () => clearInterval(id);
  }, [load]);

  const claim = async (r: Reward) => {
    setBusy(r.t.address);
    try {
      if (!(await ensureSdkWallet())) throw new Error("Wallet session expired. Reconnect and try again.");
      const hash = await v4Client.claimDividends(r.t.address as Address);
      pushToast({ kind: "info", title: "Claim submitted", txHash: hash });
      await client.publicClient.waitForTransactionReceipt({ hash });
      pushToast({ kind: "success", title: `${r.stockSym} claimed`, body: "Sent to your wallet.", txHash: hash });
      load();
    } catch (err) {
      pushToast({ kind: "error", title: "Claim failed", body: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  if (!isConnected) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="text-[20px] font-bold text-ink">My Rewards</h1>
        <p className="mt-2 text-[14px] text-ink-2">Connect your wallet to see the tokenized stocks you’ve earned.</p>
        <div className="mt-6"><Button onClick={connectFirst}>Connect wallet</Button></div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 pb-20 pt-5 sm:px-5">
      <h1 className="text-[20px] font-bold tracking-tight text-ink">My Rewards</h1>
      <p className="mt-1 text-[13.5px] text-ink-2">Tokenized stocks you’ve earned from holding — claim any time.</p>

      <div className="mt-4 overflow-hidden rounded-2xl border border-edge bg-panel/40">
        {rewards == null ? (
          <div className="space-y-2 p-3">
            {[...Array(3)].map((_, i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-panel-2" />)}
          </div>
        ) : rewards.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="text-[15px] font-semibold text-ink">No rewards yet</p>
            <p className="mt-1 text-[13.5px] text-ink-2">Hold a market and stock rewards accrue as it trades.</p>
            <Link to="/" className="mt-5 inline-block rounded-lg bg-accent px-4 py-2.5 text-[13.5px] font-semibold text-white hover:bg-accent-2">
              Discover markets
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-edge">
            {rewards.map((r) => (
              <div key={r.t.address} className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
                <Link to={`/token/${r.t.address}`} className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold text-ink">{r.t.name}</span>
                  <span className="mono block truncate text-[12px] text-up">
                    +{fmtTokens(r.pending.toString())} {r.stockSym}
                  </span>
                </Link>
                <button
                  onClick={() => claim(r)}
                  disabled={busy === r.t.address}
                  className="shrink-0 rounded-lg bg-up px-3.5 py-1.5 text-[12.5px] font-semibold text-white transition-[filter] hover:brightness-110 disabled:opacity-60"
                >
                  {busy === r.t.address ? "Claiming" : "Claim"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
