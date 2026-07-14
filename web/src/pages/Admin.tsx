import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { launchpadAbi } from "@launchpad/sdk";
import { useTokens } from "@launchpad/sdk/react";
import { useWalletClient } from "wagmi";

import { TokenLogo } from "../components/TokenTable";
import { Badge, Button, Card, CardHeader, EmptyState, Skeleton } from "../components/ui";
import { client } from "../lib/client";
import { env } from "../lib/env";
import { compact, fmtUsd, fmtWei, timeAgo } from "../lib/format";
import { errorText, useWallet } from "../lib/useWallet";
import { useUi } from "../store";

/**
 * Platform admin console. Every action here is an on-chain transaction that
 * only succeeds for wallets holding the corresponding role.
 */
export function AdminPage() {
  const { address, isConnected, connectFirst } = useWallet();
  const { data: walletClient } = useWalletClient();
  const pushToast = useUi((s) => s.pushToast);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const stats = useQuery({
    queryKey: ["platform-stats"],
    queryFn: () => client.getPlatformStats(),
    refetchInterval: 15_000,
  });

  const paused = useQuery({
    queryKey: ["launches-paused"],
    queryFn: () =>
      client.publicClient.readContract({
        address: client.addresses.launchpad,
        abi: launchpadAbi,
        functionName: "launchesPaused",
      }),
    refetchInterval: 15_000,
  });

  const treasuryBalance = useQuery({
    queryKey: ["treasury-balance"],
    queryFn: () => client.publicClient.getBalance({ address: client.addresses.treasury }),
    refetchInterval: 15_000,
  });

  const { data: tokens, loading: tokensLoading } = useTokens(client, { sort: "volume", limit: 50 });

  const lpEvents = useQuery({
    queryKey: ["lp-events"],
    queryFn: async () => {
      const res = await fetch(`${env.apiUrl}/api/lp-events?limit=30`);
      if (!res.ok) throw new Error("failed");
      return (await res.json()) as {
        token: string;
        kind: string;
        tokenAmount: string;
        wethAmount: string;
        timestamp: number;
      }[];
    },
    refetchInterval: 15_000,
  });

  const runTx = async (
    label: string,
    fn: () => Promise<`0x${string}`>,
    after?: () => void
  ) => {
    setBusyAction(label);
    try {
      const hash = await fn();
      pushToast({ kind: "info", title: `${label} submitted`, txHash: hash });
      await client.publicClient.waitForTransactionReceipt({ hash });
      pushToast({ kind: "success", title: `${label} confirmed`, txHash: hash });
      after?.();
    } catch (err) {
      pushToast({ kind: "error", title: `${label} failed`, body: errorText(err) });
    } finally {
      setBusyAction(null);
    }
  };

  const writeLaunchpad = async (functionName: string, args: unknown[]) => {
    if (!walletClient) throw new Error("Connect a wallet first");
    const { request } = await client.publicClient.simulateContract({
      account: address,
      address: client.addresses.launchpad,
      abi: launchpadAbi,
      functionName: functionName as never,
      args: args as never,
    });
    return walletClient.writeContract(request as never);
  };

  if (!isConnected) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold text-ink">Platform admin</h1>
        <p className="mt-2 text-sm text-ink-2">
          Connect an admin wallet. All controls are role-gated on-chain; a wallet without the role
          simply cannot execute them.
        </p>
        <div className="mt-6">
          <Button onClick={connectFirst}>Connect wallet</Button>
        </div>
      </div>
    );
  }

  const s = stats.data;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Platform admin</h1>
          <p className="mt-1 text-sm text-ink-2">Protocol totals, launch controls and LP management.</p>
        </div>
        <Button
          variant={paused.data ? "buy" : "danger"}
          disabled={busyAction !== null}
          onClick={() =>
            runTx(paused.data ? "Resume launches" : "Pause launches", () =>
              writeLaunchpad("setLaunchesPaused", [!paused.data]), () => paused.refetch())
          }
        >
          {paused.data ? "Resume launches" : "Pause launches"}
        </Button>
      </div>

      <section className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Total launches" value={s ? compact(s.totalLaunches) : "-"} />
        <Stat label="Total volume" value={s ? `${fmtWei(s.totalVolumeWei)} ${env.nativeSymbol}` : "-"} />
        <Stat label="Fees generated" value={s ? `${fmtWei(s.totalFeesWei)} ${env.nativeSymbol}` : "-"} />
        <Stat label="Creator payouts" value={s ? `${fmtWei(s.creatorPayoutsWei)} ${env.nativeSymbol}` : "-"} />
        <Stat label="Platform revenue" value={s ? `${fmtWei(s.platformRevenueWei)} ${env.nativeSymbol}` : "-"} />
        <Stat
          label="Treasury balance"
          value={treasuryBalance.data != null ? `${fmtWei(treasuryBalance.data)} ${env.nativeSymbol}` : "-"}
        />
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-[1fr_400px]">
        <Card>
          <CardHeader title="Tokens and LP positions" right={<span className="text-[11px] text-ink-3">sorted by volume</span>} />
          {tokensLoading ? (
            <div className="space-y-2 p-4">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : !tokens || tokens.length === 0 ? (
            <EmptyState title="No tokens yet" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b border-edge text-[10px] uppercase tracking-wider text-ink-3">
                    <th className="px-4 py-2 font-medium">Token</th>
                    <th className="tnum px-2 py-2 text-right font-medium">Market cap</th>
                    <th className="tnum px-2 py-2 text-right font-medium">Liquidity</th>
                    <th className="px-2 py-2 text-right font-medium">Featured</th>
                    <th className="px-4 py-2 text-right font-medium">LP actions</th>
                  </tr>
                </thead>
                <tbody>
                  {tokens.map((t) => (
                    <tr key={t.address} className="border-b border-edge/50">
                      <td className="px-4 py-3">
                        <Link to={`/t/${t.address}`} className="flex items-center gap-3">
                          <TokenLogo token={t} size={28} />
                          <span>
                            <span className="font-semibold text-ink">{t.symbol}</span>
                            <span className="block text-xs text-ink-3">{t.name}</span>
                          </span>
                        </Link>
                      </td>
                      <td className="tnum px-2 py-3 text-right text-ink-2">{fmtUsd(t.marketCapUsd)}</td>
                      <td className="tnum px-2 py-3 text-right text-ink-2">
                        {fmtWei(t.liquidityWei)} {env.nativeSymbol}
                      </td>
                      <td className="px-2 py-3 text-right">
                        <button
                          disabled={busyAction !== null}
                          onClick={() =>
                            runTx(t.featured ? "Unfeature token" : "Feature token", () =>
                              writeLaunchpad("setFeatured", [t.address, !t.featured]))
                          }
                          className="text-xs font-medium text-accent-2 hover:underline disabled:opacity-50"
                        >
                          {t.featured ? "Unfeature" : "Feature"}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <button
                            disabled={busyAction !== null}
                            onClick={() =>
                              runTx("Collect LP fees", () => writeLaunchpad("collectLiquidityFees", [t.address]))
                            }
                            className="rounded-md border border-edge-2 px-2 py-1 text-xs text-ink-2 hover:border-ink-3 disabled:opacity-50"
                          >
                            Collect fees
                          </button>
                          <button
                            disabled={busyAction !== null}
                            onClick={() =>
                              runTx("Withdraw 50% LP", () => writeLaunchpad("withdrawLP", [t.address, 5000]))
                            }
                            className="rounded-md border border-edge-2 px-2 py-1 text-xs text-ink-2 hover:border-ink-3 disabled:opacity-50"
                          >
                            Withdraw 50%
                          </button>
                          <button
                            disabled={busyAction !== null}
                            onClick={() => {
                              if (window.confirm(`Withdraw ALL protocol liquidity for ${t.symbol}? This drains the pool position to the treasury.`)) {
                                runTx("Withdraw all LP", () => writeLaunchpad("withdrawAllLP", [t.address]));
                              }
                            }}
                            className="rounded-md border border-down/40 px-2 py-1 text-xs text-down hover:bg-down/10 disabled:opacity-50"
                          >
                            Withdraw all
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="LP action log" />
          {lpEvents.isLoading ? (
            <div className="space-y-2 p-4">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-8" />
              ))}
            </div>
          ) : !lpEvents.data || lpEvents.data.length === 0 ? (
            <EmptyState title="No LP actions yet" body="Collections and withdrawals will be logged here from chain events." />
          ) : (
            <ul className="divide-y divide-edge/50">
              {lpEvents.data.map((e, i) => (
                <li key={i} className="flex items-center justify-between gap-2 px-4 py-2.5 text-xs">
                  <Badge tone={e.kind === "LPWithdrawn" ? "down" : e.kind === "LiquidityAdded" ? "up" : "accent"}>
                    {e.kind}
                  </Badge>
                  <span className="tnum text-ink-2">
                    {fmtWei(e.wethAmount)} {env.nativeSymbol}
                  </span>
                  <span className="text-ink-3">{timeAgo(e.timestamp)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-edge bg-panel px-4 py-3">
      <p className="text-[10px] font-medium uppercase tracking-wider text-ink-3">{label}</p>
      <p className="tnum mt-1 text-base font-semibold text-ink">{value}</p>
    </div>
  );
}
