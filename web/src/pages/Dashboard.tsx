import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { Address } from "@launchpad/sdk";

import { TokenLogo } from "../components/TokenTable";
import { Badge, Button, Card, CardHeader, EmptyState, Skeleton } from "../components/ui";
import { client } from "../lib/client";
import { env } from "../lib/env";
import { compact, explorerTx, fmtUsd, fmtWei, shortAddr, timeAgo } from "../lib/format";
import { errorText, useWallet } from "../lib/useWallet";
import { useUi } from "../store";

export function DashboardPage() {
  const { address, isConnected, connectFirst } = useWallet();
  const pushToast = useUi((s) => s.pushToast);
  const [withdrawing, setWithdrawing] = useState(false);

  const stats = useQuery({
    queryKey: ["creator", address],
    queryFn: () => client.getCreatorStats(address as Address),
    enabled: Boolean(address),
    refetchInterval: 15_000,
  });

  const revenue = useQuery({
    queryKey: ["creator-revenue", address],
    queryFn: async () => {
      const res = await fetch(`${env.apiUrl}/api/creators/${address!.toLowerCase()}/revenue?limit=50`);
      if (!res.ok) throw new Error("failed");
      return (await res.json()) as {
        token: string;
        creatorAmountWei: string;
        txHash: string;
        timestamp: number;
      }[];
    },
    enabled: Boolean(address),
    refetchInterval: 15_000,
  });

  const withdraw = async () => {
    setWithdrawing(true);
    try {
      const hash = await client.withdrawCreatorEarnings();
      pushToast({ kind: "info", title: "Withdrawal submitted", txHash: hash });
      await client.publicClient.waitForTransactionReceipt({ hash });
      pushToast({ kind: "success", title: "Earnings withdrawn", txHash: hash });
      stats.refetch();
    } catch (err) {
      pushToast({ kind: "error", title: "Withdrawal failed", body: errorText(err) });
    } finally {
      setWithdrawing(false);
    }
  };

  if (!isConnected) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold text-ink">Creator dashboard</h1>
        <p className="mt-2 text-sm text-ink-2">
          Connect your wallet to see your launches, live earnings and withdrawals.
        </p>
        <div className="mt-6">
          <Button onClick={connectFirst}>Connect wallet</Button>
        </div>
      </div>
    );
  }

  const s = stats.data;
  const pending = s ? Number(s.pendingWei) / 1e18 : 0;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Creator dashboard</h1>
      <p className="mt-1 text-sm text-ink-2">
        80% of every trading fee on your tokens accrues to you in real time.
      </p>

      <section className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Tokens launched" value={s ? String(s.tokensLaunched) : "-"} loading={stats.isLoading} />
        <Stat
          label="Trading volume"
          value={s ? `${fmtWei(s.totalVolumeWei)} ${env.nativeSymbol}` : "-"}
          loading={stats.isLoading}
        />
        <Stat
          label="Lifetime earnings"
          value={s ? `${fmtWei(s.lifetimeEarnedWei)} ${env.nativeSymbol}` : "-"}
          loading={stats.isLoading}
        />
        <div className="rounded-xl border border-up/30 bg-up/5 px-4 py-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-ink-3">Withdrawable</p>
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className="tnum text-lg font-semibold text-up">
              {s ? `${fmtWei(s.pendingWei)} ${env.nativeSymbol}` : "-"}
            </p>
            <Button
              variant="buy"
              onClick={withdraw}
              disabled={withdrawing || pending === 0}
              className="px-3 py-1.5 text-xs"
            >
              {withdrawing ? "Confirming" : "Withdraw"}
            </Button>
          </div>
        </div>
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader title="Your tokens" />
          {stats.isLoading ? (
            <div className="space-y-2 p-4">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : !s || s.tokens.length === 0 ? (
            <EmptyState title="No launches yet" body="Launch your first token and its stats appear here." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead>
                  <tr className="border-b border-edge text-[10px] uppercase tracking-wider text-ink-3">
                    <th className="px-4 py-2 font-medium">Token</th>
                    <th className="tnum px-2 py-2 text-right font-medium">Market cap</th>
                    <th className="tnum px-2 py-2 text-right font-medium">24h volume</th>
                    <th className="tnum px-2 py-2 text-right font-medium">Holders</th>
                    <th className="px-4 py-2 text-right font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {s.tokens.map((t) => (
                    <tr key={t.address} className="group border-b border-edge/50 hover:bg-panel-2/50">
                      <td className="px-4 py-3">
                        <Link to={`/t/${t.address}`} className="flex items-center gap-3">
                          <TokenLogo token={t} size={28} />
                          <span>
                            <span className="font-semibold text-ink group-hover:text-accent-2">{t.symbol}</span>
                            <span className="block text-xs text-ink-3">{t.name}</span>
                          </span>
                        </Link>
                      </td>
                      <td className="tnum px-2 py-3 text-right text-ink-2">{fmtUsd(t.marketCapUsd)}</td>
                      <td className="tnum px-2 py-3 text-right text-ink-2">
                        {fmtWei(t.volume24hWei)} {env.nativeSymbol}
                      </td>
                      <td className="tnum px-2 py-3 text-right text-ink-2">{compact(t.holderCount)}</td>
                      <td className="px-4 py-3 text-right">
                        {t.limitsActive ? <Badge tone="amber">Protected</Badge> : <Badge tone="up">Open</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Revenue history" />
          {revenue.isLoading ? (
            <div className="space-y-2 p-4">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-8" />
              ))}
            </div>
          ) : !revenue.data || revenue.data.length === 0 ? (
            <EmptyState title="No fees earned yet" body="Each trade on your tokens adds a row here." />
          ) : (
            <ul className="divide-y divide-edge/50">
              {revenue.data.map((r, i) => (
                <li key={i} className="flex items-center justify-between px-4 py-2.5 text-xs">
                  <span className="text-ink-3">{timeAgo(r.timestamp)}</span>
                  <span className="tnum font-medium text-up">
                    +{fmtWei(r.creatorAmountWei, 6)} {env.nativeSymbol}
                  </span>
                  {explorerTx(r.txHash) ? (
                    <a href={explorerTx(r.txHash)!} target="_blank" rel="noreferrer" className="text-accent-2 hover:underline">
                      Tx
                    </a>
                  ) : (
                    <span className="tnum text-ink-3">{shortAddr(r.txHash)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}

function Stat({ label, value, loading }: { label: string; value: string; loading?: boolean }) {
  return (
    <div className="rounded-xl border border-edge bg-panel px-4 py-3">
      <p className="text-[10px] font-medium uppercase tracking-wider text-ink-3">{label}</p>
      {loading ? (
        <Skeleton className="mt-1 h-6 w-24" />
      ) : (
        <p className="tnum mt-1 text-lg font-semibold text-ink">{value}</p>
      )}
    </div>
  );
}
