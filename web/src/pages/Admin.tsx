import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { launchpadAbi } from "@launchpad/sdk";
import { useTokens } from "@launchpad/sdk/react";
import { erc20Abi, isAddress } from "viem";
import { useWalletClient } from "wagmi";

import { TokenLogo } from "../components/TokenLogo";
import { Badge, Button, Card, EmptyState, Skeleton } from "../components/ui";
import { client } from "../lib/client";
import { env } from "../lib/env";
import { compact, fmtUsd, fmtWei, shortAddr, timeAgo } from "../lib/format";
import { errorText, useWallet } from "../lib/useWallet";
import { useUi } from "../store";

const ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

const treasuryAbi = [
  {
    type: "function",
    name: "withdrawNative",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "withdrawToken",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

const wethWithdrawAbi = [
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [{ name: "wad", type: "uint256" }],
    outputs: [],
  },
] as const;

/**
 * Hidden operations console. Not linked from anywhere; access is enforced
 * on-chain by roles and mirrored here: wallets without DEFAULT_ADMIN_ROLE
 * get a 403 and no data.
 */
export function AdminPage() {
  const { address, isConnected, connectFirst } = useWallet();
  const { data: walletClient } = useWalletClient();
  const pushToast = useUi((s) => s.pushToast);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const isAdmin = useQuery({
    queryKey: ["is-admin", address],
    queryFn: () =>
      client.publicClient.readContract({
        address: client.addresses.launchpad,
        abi: launchpadAbi,
        functionName: "hasRole",
        args: [ADMIN_ROLE, address!],
      }),
    enabled: Boolean(address),
  });

  const stats = useQuery({
    queryKey: ["platform-stats"],
    queryFn: () => client.getPlatformStats(),
    refetchInterval: 15_000,
    enabled: isAdmin.data === true,
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
    enabled: isAdmin.data === true,
  });

  const treasuryBalance = useQuery({
    queryKey: ["treasury-balance"],
    queryFn: () => client.publicClient.getBalance({ address: client.addresses.treasury }),
    refetchInterval: 15_000,
    enabled: isAdmin.data === true,
  });

  const treasuryWeth = useQuery({
    queryKey: ["treasury-weth"],
    queryFn: () =>
      client.publicClient.readContract({
        address: client.addresses.weth,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [client.addresses.treasury],
      }),
    refetchInterval: 15_000,
    enabled: isAdmin.data === true,
  });

  const walletWeth = useQuery({
    queryKey: ["wallet-weth", address],
    queryFn: () =>
      client.publicClient.readContract({
        address: client.addresses.weth,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address!],
      }),
    refetchInterval: 15_000,
    enabled: isAdmin.data === true && Boolean(address),
  });

  const { data: tokens, loading: tokensLoading } = useTokens(client, { sort: "volume", limit: 50 });

  // Treasury withdrawals: destination address. Defaults to the connected
  // wallet, but can be any address (e.g. a token's creator wallet).
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
    enabled: isAdmin.data === true && Boolean(lookupAddr),
    retry: false,
  });

  // Treasury + admin balances of the looked-up token (the token side of
  // withdrawn LP). The wallet balance is needed to respect max-wallet caps.
  const treasuryTokenBal = useQuery({
    queryKey: ["treasury-token-bal", lookupAddr?.toLowerCase(), address],
    queryFn: async () => {
      const balanceOf = (holder: `0x${string}`) =>
        client.publicClient.readContract({
          address: lookupAddr!,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [holder],
        });
      const [inTreasury, inWallet, limits] = await Promise.all([
        balanceOf(client.addresses.treasury),
        balanceOf(address!),
        client.getTradingLimits(lookupAddr!),
      ]);
      return { inTreasury, inWallet, limits };
    },
    refetchInterval: 15_000,
    enabled: isAdmin.data === true && Boolean(lookupAddr) && Boolean(address) && lookup.isSuccess,
  });

  // While anti-whale limits are active the token itself caps any transfer out
  // of the Treasury (max tx, and max wallet on the recipient).
  const min = (...xs: bigint[]) => xs.reduce((a, b) => (b < a ? b : a));
  const tokenWithdrawable = (() => {
    const d = treasuryTokenBal.data;
    if (!d) return 0n;
    if (!d.limits.active) return d.inTreasury;
    const walletRoom = BigInt(d.limits.maxWalletAmount) - d.inWallet;
    return min(d.inTreasury, BigInt(d.limits.maxTxAmount), walletRoom > 0n ? walletRoom : 0n);
  })();

  const lpEvents = useQuery({
    queryKey: ["lp-events"],
    queryFn: async () => {
      if (!env.apiUrl) return [];
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
    enabled: isAdmin.data === true,
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

  const writeContractAt = async (
    contract: `0x${string}`,
    abi: unknown,
    functionName: string,
    args: unknown[]
  ) => {
    if (!walletClient) throw new Error("Connect a wallet first");
    const { request } = await client.publicClient.simulateContract({
      account: address,
      address: contract,
      abi: abi as never,
      functionName: functionName as never,
      args: args as never,
    });
    return walletClient.writeContract(request as never);
  };

  // Shared LP action buttons, used by the token table and the address lookup.
  const lpActions = (t: { address: string; symbol: string }) => (
    <div className="flex justify-end gap-2">
      <button
        disabled={busyAction !== null}
        onClick={() => runTx("Collect fees", () => writeLaunchpad("collectFees", [t.address]))}
        className="h-8 rounded-full border border-edge px-3 text-xs font-medium text-ink-2 transition-colors hover:border-edge-2 hover:text-ink disabled:opacity-50"
      >
        Collect fees
      </button>
      <button
        disabled={busyAction !== null}
        onClick={() => runTx("Collect 50% of position", () => writeLaunchpad("collectFees", [t.address, 5000]))}
        className="h-8 rounded-full border border-edge px-3 text-xs font-medium text-ink-2 transition-colors hover:border-edge-2 hover:text-ink disabled:opacity-50"
      >
        Withdraw 50%
      </button>
      <button
        disabled={busyAction !== null}
        onClick={() => {
          if (
            window.confirm(
              `Collect the FULL position for ${t.symbol}? This settles all pool liquidity to the treasury.`
            )
          ) {
            runTx("Collect full position", () => writeLaunchpad("collectFees", [t.address, 10000]));
          }
        }}
        className="h-8 rounded-full border border-down/40 px-3 text-xs font-medium text-down transition-colors hover:bg-down/5 disabled:opacity-50"
      >
        Withdraw all
      </button>
    </div>
  );

  if (!isConnected) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="text-xl font-semibold text-ink">Restricted area</h1>
        <p className="mt-2 text-sm text-ink-2">Connect an authorized wallet to continue.</p>
        <div className="mt-6">
          <Button variant="dark" onClick={connectFirst}>
            Connect Wallet
          </Button>
        </div>
      </div>
    );
  }

  if (isAdmin.isLoading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <Skeleton className="h-24" />
      </div>
    );
  }

  if (isAdmin.data !== true) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <p className="tnum text-5xl font-semibold text-ink-3">403</p>
        <h1 className="mt-3 text-xl font-semibold text-ink">Unauthorized</h1>
        <p className="mt-2 text-sm text-ink-2">
          This wallet does not hold the admin role for the protocol.
        </p>
        <Link to="/" className="mt-6 inline-block text-sm font-medium text-ink underline underline-offset-2">
          Back to Explore
        </Link>
      </div>
    );
  }

  const s = stats.data;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight text-ink">Operations</h1>
          <p className="mt-1 text-sm text-ink-2">Role-gated protocol controls. Every action is an on-chain transaction.</p>
        </div>
        <Button
          variant={paused.data ? "primary" : "danger"}
          disabled={busyAction !== null}
          onClick={() =>
            runTx(paused.data ? "Resume launches" : "Pause launches", () =>
              writeLaunchpad("setLaunchesPaused", [!paused.data]), () => paused.refetch())
          }
        >
          {paused.data ? "Resume launches" : "Pause launches"}
        </Button>
      </div>

      <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-3 border-y border-edge py-4">
        <Figure label="Launches" value={s ? compact(s.totalLaunches) : "-"} />
        <Figure label="Total volume" value={s ? `${fmtWei(s.totalVolumeWei)} ${env.nativeSymbol}` : "-"} />
        <Figure label="Creator fees paid" value={s ? `${fmtWei(s.creatorPayoutsWei)} ${env.nativeSymbol}` : "-"} />
        <Figure
          label="Treasury"
          value={treasuryBalance.data != null ? `${fmtWei(treasuryBalance.data)} ${env.nativeSymbol}` : "-"}
        />
      </dl>

      <Card className="mt-8 overflow-hidden">
        <div className="border-b border-edge px-5 py-3.5">
          <h2 className="text-sm font-semibold text-ink">Manage a token by address</h2>
          <p className="mt-0.5 text-xs text-ink-3">
            Paste a token contract address to collect its pool fees or withdraw its liquidity.
            Proceeds settle to the Treasury below; withdraw them to your wallet from there.
          </p>
        </div>
        <div className="space-y-3 p-5">
          <input
            value={lookupInput}
            onChange={(e) => setLookupInput(e.target.value)}
            placeholder="Paste token contract address (0x…)"
            spellCheck={false}
            autoComplete="off"
            className="tnum h-10 w-full rounded-xl border border-edge bg-panel px-3.5 text-sm text-ink placeholder:text-ink-3 focus:border-edge-2 focus:outline-none"
          />
          {trimmedLookup.length > 0 && !lookupAddr ? (
            <p className="text-xs text-down">That is not a valid address.</p>
          ) : lookup.isLoading ? (
            <Skeleton className="h-14" />
          ) : lookup.isError ? (
            <p className="text-xs text-down">This address is not a token launched here.</p>
          ) : lookup.data ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-edge px-4 py-3">
              <Link to={`/token/${lookup.data.address}`} className="flex min-w-0 items-center gap-3">
                <TokenLogo token={lookup.data} size={32} />
                <span className="min-w-0">
                  <span className="font-semibold text-ink">${lookup.data.symbol}</span>
                  <span className="block truncate text-xs text-ink-3">
                    {lookup.data.name} · {fmtUsd(lookup.data.marketCapUsd)} mcap ·{" "}
                    {fmtWei(lookup.data.liquidityWei)} {env.nativeSymbol} liquidity
                  </span>
                </span>
              </Link>
              {lpActions(lookup.data)}
            </div>
          ) : null}
        </div>
      </Card>

      <Card className="mt-5 overflow-hidden">
        <div className="space-y-3 border-b border-edge px-5 py-3.5">
          <div>
            <h2 className="text-sm font-semibold text-ink">Treasury</h2>
            <p className="mt-0.5 text-xs text-ink-3">
              Withdrawn liquidity and collected fees land here first. Send them on to any address.
            </p>
          </div>
          <div>
            <label className="text-xs font-medium text-ink-2">Send withdrawals to</label>
            <input
              value={destInput}
              onChange={(e) => setDestInput(e.target.value)}
              placeholder={address ? `${address} (your wallet)` : "Paste destination address (0x…)"}
              spellCheck={false}
              autoComplete="off"
              className="tnum mt-1 h-10 w-full rounded-xl border border-edge bg-panel px-3.5 text-sm text-ink placeholder:text-ink-3 focus:border-edge-2 focus:outline-none"
            />
            {trimmedDest.length > 0 && !destAddr ? (
              <p className="mt-1 text-xs text-down">That is not a valid address.</p>
            ) : (
              <p className="mt-1 text-xs text-ink-3">
                Destination: <span className="tnum">{shortAddr(destAddr ?? "")}</span>
                {!trimmedDest ? " (your connected wallet)" : ""}
              </p>
            )}
          </div>
        </div>
        <ul className="divide-y divide-edge/60">
          <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
            <div>
              <p className="text-sm font-medium text-ink">{env.nativeSymbol} (native)</p>
              <p className="tnum text-xs text-ink-3">
                {treasuryBalance.data != null ? fmtWei(treasuryBalance.data) : "-"} {env.nativeSymbol}
              </p>
            </div>
            <button
              disabled={busyAction !== null || !treasuryBalance.data || !destAddr}
              onClick={() =>
                runTx(
                  "Withdraw treasury ETH",
                  () =>
                    writeContractAt(client.addresses.treasury, treasuryAbi, "withdrawNative", [
                      destAddr,
                      treasuryBalance.data,
                    ]),
                  () => treasuryBalance.refetch()
                )
              }
              className="h-8 rounded-full border border-edge px-3 text-xs font-medium text-ink-2 transition-colors hover:border-edge-2 hover:text-ink disabled:opacity-50"
            >
              Withdraw
            </button>
          </li>
          <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
            <div>
              <p className="text-sm font-medium text-ink">WETH</p>
              <p className="tnum text-xs text-ink-3">
                {treasuryWeth.data != null ? fmtWei(treasuryWeth.data) : "-"} WETH
                {walletWeth.data ? ` · you hold ${fmtWei(walletWeth.data)} WETH` : ""}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                disabled={busyAction !== null || !treasuryWeth.data || !destAddr}
                onClick={() =>
                  runTx(
                    "Withdraw treasury WETH",
                    () =>
                      writeContractAt(client.addresses.treasury, treasuryAbi, "withdrawToken", [
                        client.addresses.weth,
                        destAddr,
                        treasuryWeth.data,
                      ]),
                    () => {
                      treasuryWeth.refetch();
                      walletWeth.refetch();
                    }
                  )
                }
                className="h-8 rounded-full border border-edge px-3 text-xs font-medium text-ink-2 transition-colors hover:border-edge-2 hover:text-ink disabled:opacity-50"
              >
                Withdraw
              </button>
              <button
                disabled={busyAction !== null || !walletWeth.data}
                onClick={() =>
                  runTx(
                    "Unwrap WETH",
                    () =>
                      writeContractAt(client.addresses.weth, wethWithdrawAbi, "withdraw", [
                        walletWeth.data,
                      ]),
                    () => walletWeth.refetch()
                  )
                }
                className="h-8 rounded-full border border-edge px-3 text-xs font-medium text-ink-2 transition-colors hover:border-edge-2 hover:text-ink disabled:opacity-50"
              >
                Unwrap to {env.nativeSymbol}
              </button>
            </div>
          </li>
          {lookup.data && treasuryTokenBal.data && treasuryTokenBal.data.inTreasury > 0n ? (
            <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div>
                <p className="text-sm font-medium text-ink">${lookup.data.symbol}</p>
                <p className="tnum text-xs text-ink-3">
                  {fmtWei(treasuryTokenBal.data.inTreasury)} in treasury
                  {lookup.data.limitsActive
                    ? ` · limits active, max ${fmtWei(tokenWithdrawable)} per withdrawal`
                    : ""}
                </p>
              </div>
              <button
                disabled={busyAction !== null || tokenWithdrawable === 0n || !destAddr}
                onClick={() =>
                  runTx(
                    `Withdraw treasury ${lookup.data!.symbol}`,
                    () =>
                      writeContractAt(client.addresses.treasury, treasuryAbi, "withdrawToken", [
                        lookup.data!.address,
                        destAddr,
                        tokenWithdrawable,
                      ]),
                    () => treasuryTokenBal.refetch()
                  )
                }
                className="h-8 rounded-full border border-edge px-3 text-xs font-medium text-ink-2 transition-colors hover:border-edge-2 hover:text-ink disabled:opacity-50"
              >
                Withdraw
              </button>
            </li>
          ) : null}
        </ul>
      </Card>

      <section className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[1fr_360px]">
        <Card className="overflow-hidden">
          <h2 className="border-b border-edge px-5 py-3.5 text-sm font-semibold text-ink">
            Tokens and LP positions
          </h2>
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
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead>
                  <tr className="border-b border-edge text-xs text-ink-3">
                    <th className="px-5 py-2 font-medium">Token</th>
                    <th className="tnum px-2 py-2 text-right font-medium">Market cap</th>
                    <th className="tnum px-2 py-2 text-right font-medium">Liquidity</th>
                    <th className="px-2 py-2 text-right font-medium">Featured</th>
                    <th className="px-5 py-2 text-right font-medium">LP actions</th>
                  </tr>
                </thead>
                <tbody>
                  {tokens.map((t) => (
                    <tr key={t.address} className="border-b border-edge/60">
                      <td className="px-5 py-3">
                        <Link to={`/token/${t.address}`} className="flex items-center gap-3">
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
                          className="text-xs font-medium text-ink underline underline-offset-2 disabled:opacity-50"
                        >
                          {t.featured ? "Unfeature" : "Feature"}
                        </button>
                      </td>
                      <td className="px-5 py-3">{lpActions(t)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="h-fit overflow-hidden">
          <h2 className="border-b border-edge px-5 py-3.5 text-sm font-semibold text-ink">LP action log</h2>
          {lpEvents.isLoading ? (
            <div className="space-y-2 p-4">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-8" />
              ))}
            </div>
          ) : !lpEvents.data || lpEvents.data.length === 0 ? (
            <EmptyState title="No LP actions yet" />
          ) : (
            <ul className="divide-y divide-edge/60">
              {lpEvents.data.map((e, i) => (
                <li key={i} className="flex items-center justify-between gap-2 px-5 py-2.5 text-xs">
                  <Badge tone={e.kind === "FeesCollected" ? "neutral" : "up"}>
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

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dd className="tnum text-[15px] font-semibold text-ink">{value}</dd>
      <dt className="mt-0.5 text-xs text-ink-3">{label}</dt>
    </div>
  );
}
