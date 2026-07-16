import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { launchpadAbi } from "@launchpad/sdk";
import { useTokens } from "@launchpad/sdk/react";
import { isAddress } from "viem";
import { useWalletClient } from "wagmi";

import { TokenLogo } from "../components/TokenLogo";
import { Button, EmptyState, Skeleton } from "../components/ui";
import { client } from "../lib/client";
import { env } from "../lib/env";
import { compact, fmtUsd, fmtWei, shortAddr } from "../lib/format";
import { errorText, useWallet } from "../lib/useWallet";
import { useUi } from "../store";

/**
 * Hidden operations console for the protocol admin. Access is enforced
 * on-chain by the factory's immutable protocolAdmin: any other wallet reads
 * a 403 and can call nothing. Every action here is a direct transaction to
 * the factory, and LP/fee proceeds settle straight to the chosen recipient.
 */
export function AdminPage() {
  const { address, isConnected, connectFirst } = useWallet();
  const { data: walletClient } = useWalletClient();
  const pushToast = useUi((s) => s.pushToast);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const protocolAdmin = useQuery({
    queryKey: ["protocol-admin"],
    queryFn: () =>
      client.publicClient.readContract({
        address: client.addresses.factory,
        abi: launchpadAbi,
        functionName: "protocolAdmin",
      }),
  });
  const isAdmin =
    protocolAdmin.data && address
      ? (protocolAdmin.data as string).toLowerCase() === address.toLowerCase()
      : false;

  const stats = useQuery({
    queryKey: ["protocol-stats"],
    queryFn: async () => {
      const [launches, volume, fees, protocolFees] = await Promise.all([
        client.publicClient.readContract({ address: client.addresses.factory, abi: launchpadAbi, functionName: "totalLaunches" }),
        client.publicClient.readContract({ address: client.addresses.factory, abi: launchpadAbi, functionName: "totalTradeVolumeWei" }),
        client.publicClient.readContract({ address: client.addresses.factory, abi: launchpadAbi, functionName: "totalFeesWei" }),
        client.publicClient.readContract({ address: client.addresses.factory, abi: launchpadAbi, functionName: "protocolFeesAccrued" }),
      ]);
      return {
        totalLaunches: Number(launches),
        totalVolumeWei: (volume as bigint).toString(),
        totalFeesWei: (fees as bigint).toString(),
        protocolFeesWei: protocolFees as bigint,
      };
    },
    refetchInterval: 15_000,
    enabled: isAdmin,
  });

  const paused = useQuery({
    queryKey: ["launches-paused"],
    queryFn: () =>
      client.publicClient.readContract({
        address: client.addresses.factory,
        abi: launchpadAbi,
        functionName: "launchesPaused",
      }),
    refetchInterval: 15_000,
    enabled: isAdmin,
  });

  const { data: tokens, loading: tokensLoading } = useTokens(client, { sort: "volume", limit: 50 });

  // Destination for LP withdrawals and fee collection. Defaults to the
  // connected admin wallet, but can be any address (e.g. a team multisig).
  const [destInput, setDestInput] = useState("");
  const trimmedDest = destInput.trim();
  const destAddr: `0x${string}` | null = trimmedDest
    ? isAddress(trimmedDest)
      ? (trimmedDest as `0x${string}`)
      : null
    : (address ?? null);

  // "Manage by address" lookup: paste any launched token's contract address.
  const [lookupInput, setLookupInput] = useState("");
  const trimmedLookup = lookupInput.trim();
  const lookupAddr = isAddress(trimmedLookup) ? (trimmedLookup as `0x${string}`) : null;
  const lookup = useQuery({
    queryKey: ["admin-token-lookup", lookupAddr?.toLowerCase()],
    queryFn: () => client.getToken(lookupAddr!),
    enabled: isAdmin && Boolean(lookupAddr),
    retry: false,
  });

  const runTx = async (label: string, fn: () => Promise<`0x${string}`>, after?: () => void) => {
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

  const writeFactory = async (functionName: string, args: unknown[]) => {
    if (!walletClient) throw new Error("Connect a wallet first");
    const { request } = await client.publicClient.simulateContract({
      account: address,
      address: client.addresses.factory,
      abi: launchpadAbi,
      functionName: functionName as never,
      args: args as never,
    });
    return walletClient.writeContract(request as never);
  };

  // LP actions: proceeds settle straight to the chosen recipient (no treasury).
  const lpActions = (t: { address: string; symbol: string }) => (
    <div className="flex justify-end gap-1.5">
      <button
        disabled={busyAction !== null || !destAddr}
        onClick={() => runTx("Collect fees", () => writeFactory("collectPositionFees", [t.address, destAddr]))}
        className="rounded-md border border-edge bg-panel px-2.5 py-1 text-[11px] font-semibold text-ink-2 transition-colors hover:border-edge-2 hover:text-ink disabled:opacity-50"
      >
        Collect fees
      </button>
      <button
        disabled={busyAction !== null || !destAddr}
        onClick={() => runTx("Withdraw 50% of position", () => writeFactory("unwindPosition", [t.address, 5000, destAddr]))}
        className="rounded-md border border-edge bg-panel px-2.5 py-1 text-[11px] font-semibold text-ink-2 transition-colors hover:border-edge-2 hover:text-ink disabled:opacity-50"
      >
        Withdraw 50%
      </button>
      <button
        disabled={busyAction !== null || !destAddr}
        onClick={() => {
          if (
            window.confirm(
              `Unwind the FULL position for ${t.symbol}? This removes all pool liquidity and sends it to ${shortAddr(destAddr ?? "")}.`
            )
          ) {
            runTx("Unwind full position", () => writeFactory("unwindPosition", [t.address, 10000, destAddr]));
          }
        }}
        className="rounded-md border border-down/40 bg-down/5 px-2.5 py-1 text-[11px] font-semibold text-down transition-colors hover:bg-down/10 disabled:opacity-50"
      >
        Withdraw all
      </button>
    </div>
  );

  if (!isConnected) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <p className="mono text-[11px] uppercase tracking-wide text-ink-3">Operations console</p>
        <h1 className="mt-2 text-xl font-bold text-ink">Restricted area</h1>
        <p className="mt-2 text-sm text-ink-2">Connect the protocol admin wallet to continue.</p>
        <div className="mt-6">
          <Button variant="dark" onClick={connectFirst}>
            Connect Wallet
          </Button>
        </div>
      </div>
    );
  }

  if (protocolAdmin.isLoading) {
    return (
      <div className="mx-auto max-w-[1100px] px-4 py-6">
        <Skeleton className="h-24" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <p className="mono text-5xl font-bold text-down">403</p>
        <h1 className="mt-3 text-xl font-bold text-ink">Unauthorized</h1>
        <p className="mt-2 text-sm text-ink-2">
          This wallet is not the protocol admin. Only the immutable admin can manage the protocol.
        </p>
        <Link to="/" className="mono mt-6 inline-block text-sm font-medium text-accent underline underline-offset-2">
          Back to Markets
        </Link>
      </div>
    );
  }

  const s = stats.data;

  return (
    <div className="mx-auto max-w-[1100px] px-3 py-4 sm:px-4">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-edge bg-panel px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-accent" />
          <h1 className="text-[15px] font-bold tracking-tight text-ink">Operations</h1>
          <span className="mono rounded bg-panel-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-3">admin</span>
        </div>
        <button
          disabled={busyAction !== null}
          onClick={() =>
            runTx(paused.data ? "Resume launches" : "Pause launches", () =>
              writeFactory("setLaunchesPaused", [!paused.data]), () => paused.refetch())
          }
          className={`rounded-md px-3 py-1.5 text-[12px] font-bold uppercase tracking-wide transition-colors disabled:opacity-50 ${
            paused.data ? "bg-accent text-black hover:bg-accent-2" : "bg-down/10 text-down hover:bg-down/20"
          }`}
        >
          {paused.data ? "Resume launches" : "Pause launches"}
        </button>
      </div>

      {/* Figures strip */}
      <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-edge bg-edge sm:grid-cols-4">
        <Figure label="Launches" value={s ? compact(s.totalLaunches) : "—"} />
        <Figure label="Total volume" value={s ? `${fmtWei(s.totalVolumeWei)} ${env.nativeSymbol}` : "—"} />
        <Figure label="Fees generated" value={s ? `${fmtWei(s.totalFeesWei)} ${env.nativeSymbol}` : "—"} />
        <Figure label="Protocol claimable" value={s ? `${fmtWei(s.protocolFeesWei)} ${env.nativeSymbol}` : "—"} accent />
      </div>

      {/* Protocol fees claim */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-edge bg-panel px-4 py-3">
        <div>
          <h2 className="text-[13px] font-semibold text-ink">Protocol fees</h2>
          <p className="mt-0.5 text-[11px] text-ink-3">
            The protocol's share of trading fees. Claiming sends the full balance to the admin wallet.
          </p>
        </div>
        <button
          disabled={busyAction !== null || !s || s.protocolFeesWei === 0n}
          onClick={() => runTx("Claim protocol fees", () => writeFactory("claimPlatformFees", []), () => stats.refetch())}
          className="mono rounded-md bg-accent px-3 py-1.5 text-[12px] font-bold text-black transition-colors hover:bg-accent-2 disabled:opacity-40"
        >
          Claim {s ? `${fmtWei(s.protocolFeesWei)} ${env.nativeSymbol}` : ""}
        </button>
      </div>

      {/* Manage by address */}
      <div className="mt-3 overflow-hidden rounded-xl border border-edge bg-panel">
        <div className="border-b border-edge px-4 py-3">
          <h2 className="text-[13px] font-semibold text-ink">Manage a token's liquidity by address</h2>
          <p className="mt-0.5 text-[11px] text-ink-3">
            Paste a token contract address to collect its pool fees or withdraw its liquidity. Proceeds go to the recipient below.
          </p>
        </div>
        <div className="space-y-3 p-4">
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wide text-ink-3">Send proceeds to</label>
            <input
              value={destInput}
              onChange={(e) => setDestInput(e.target.value)}
              placeholder={address ? `${address} (your wallet)` : "Paste recipient address (0x…)"}
              spellCheck={false}
              autoComplete="off"
              className="mono mt-1 h-10 w-full rounded-lg border border-edge bg-panel-2/40 px-3 text-[12px] text-ink placeholder:text-ink-3 focus:border-edge-2 focus:outline-none"
            />
            {trimmedDest.length > 0 && !destAddr ? (
              <p className="mt-1 text-[11px] text-down">That is not a valid address.</p>
            ) : (
              <p className="mono mt-1 text-[11px] text-ink-3">
                Recipient: {shortAddr(destAddr ?? "")}
                {!trimmedDest ? " (your wallet)" : ""}
              </p>
            )}
          </div>
          <input
            value={lookupInput}
            onChange={(e) => setLookupInput(e.target.value)}
            placeholder="Paste token contract address (0x…)"
            spellCheck={false}
            autoComplete="off"
            className="mono h-10 w-full rounded-lg border border-edge bg-panel-2/40 px-3 text-[12px] text-ink placeholder:text-ink-3 focus:border-edge-2 focus:outline-none"
          />
          {trimmedLookup.length > 0 && !lookupAddr ? (
            <p className="text-[11px] text-down">That is not a valid address.</p>
          ) : lookup.isLoading ? (
            <Skeleton className="h-14" />
          ) : lookup.isError ? (
            <p className="text-[11px] text-down">This address is not a token launched here.</p>
          ) : lookup.data ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-edge bg-panel-2/40 px-3 py-2.5">
              <Link to={`/token/${lookup.data.address}`} className="flex min-w-0 items-center gap-3">
                <TokenLogo token={lookup.data} size={30} />
                <span className="min-w-0">
                  <span className="text-[13px] font-semibold text-ink">${lookup.data.symbol}</span>
                  <span className="mono block truncate text-[11px] text-ink-3">
                    {lookup.data.name} · {fmtUsd(lookup.data.marketCapUsd)} · {fmtWei(lookup.data.liquidityWei)} {env.nativeSymbol} liq
                  </span>
                </span>
              </Link>
              {lpActions(lookup.data)}
            </div>
          ) : null}
        </div>
      </div>

      {/* Token table */}
      <div className="mt-3 overflow-hidden rounded-xl border border-edge bg-panel">
        <h2 className="border-b border-edge px-4 py-3 text-[13px] font-semibold text-ink">Tokens &amp; LP positions</h2>
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
            <table className="w-full min-w-[680px] border-collapse text-left">
              <thead>
                <tr className="border-b border-edge text-[10px] uppercase tracking-wide text-ink-3">
                  <th className="px-4 py-2 font-semibold">Token</th>
                  <th className="px-2 py-2 text-right font-semibold">MCap</th>
                  <th className="px-2 py-2 text-right font-semibold">Liquidity</th>
                  <th className="px-2 py-2 text-right font-semibold">Featured</th>
                  <th className="px-4 py-2 text-right font-semibold">LP actions</th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((t) => (
                  <tr key={t.address} className="border-b border-edge/60 transition-colors last:border-0 hover:bg-panel-2">
                    <td className="px-4 py-2.5">
                      <Link to={`/token/${t.address}`} className="flex items-center gap-2.5">
                        <TokenLogo token={t} size={26} />
                        <span>
                          <span className="text-[13px] font-semibold text-ink">{t.symbol}</span>
                          <span className="block text-[11px] text-ink-3">{t.name}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="mono px-2 py-2.5 text-right text-[12px] text-ink-2">{fmtUsd(t.marketCapUsd)}</td>
                    <td className="mono px-2 py-2.5 text-right text-[12px] text-ink-2">
                      {fmtWei(t.liquidityWei)} {env.nativeSymbol}
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      <button
                        disabled={busyAction !== null}
                        onClick={() =>
                          runTx(t.featured ? "Unfeature token" : "Feature token", () =>
                            writeFactory("setFeatured", [t.address, !t.featured]))
                        }
                        className="text-[11px] font-semibold text-accent underline underline-offset-2 disabled:opacity-50"
                      >
                        {t.featured ? "Unfeature" : "Feature"}
                      </button>
                    </td>
                    <td className="px-4 py-2.5">{lpActions(t)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Figure({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-panel px-3 py-2.5">
      <dt className="text-[10px] uppercase tracking-wide text-ink-3">{label}</dt>
      <dd className={`mono mt-0.5 text-[14px] font-bold ${accent ? "text-accent" : "text-ink"}`}>{value}</dd>
    </div>
  );
}
