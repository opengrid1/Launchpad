import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Candle, CandleInterval, TradeRecord } from "@launchpad/sdk";
import type { Address, Hash } from "viem";
import { useAccount } from "wagmi";

import { client, publicClient, type PairInfo, type StockToken } from "./client";
import { DEPLOYED } from "./env";

export type Token = StockToken;

export function useTokens() {
  return useQuery({ queryKey: ["tokens"], queryFn: () => client.getTokens({ limit: 120 }), refetchInterval: 30_000, staleTime: 10_000, enabled: DEPLOYED });
}

export function useToken(address?: string) {
  return useQuery({ queryKey: ["token", address?.toLowerCase()], queryFn: () => client.getToken(address!), enabled: !!address && DEPLOYED, refetchInterval: 30_000 });
}

/** Pair assets approved on the factory, ETH first then by liquidity. */
export function useQuotes() {
  return useQuery({ queryKey: ["quotes"], queryFn: () => client.quotes(), staleTime: 120_000, enabled: DEPLOYED });
}

export function usePair(address?: Address, fromToken?: PairInfo) {
  return useQuery({ queryKey: ["pair", address?.toLowerCase()], queryFn: () => client.pairOf(address!), enabled: !!address && !fromToken, staleTime: 300_000, initialData: fromToken });
}

export function useRewards(token?: Address, account?: Address) {
  return useQuery({ queryKey: ["rewards", token?.toLowerCase(), account?.toLowerCase()], queryFn: () => client.rewards(token!, account), enabled: !!token, refetchInterval: 30_000 });
}

export function useFeeNow(token?: Address) {
  return useQuery({ queryKey: ["feeNow", token?.toLowerCase()], queryFn: () => client.feeNow(token!), enabled: !!token, refetchInterval: 5_000 });
}

export function useConfig() {
  return useQuery({ queryKey: ["config"], queryFn: () => client.config(), staleTime: 60_000, enabled: DEPLOYED });
}

/** True when the connected wallet is the factory's admin. */
export function useIsAdmin() {
  const { address } = useAccount();
  const { data } = useConfig();
  return !!address && !!data && data.admin.toLowerCase() === address.toLowerCase();
}

export function useTrades(address?: string) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["trades", address?.toLowerCase()], queryFn: () => client.getTrades(address!, { limit: 100 }), enabled: !!address, refetchInterval: 30_000 });
  useEffect(() => {
    if (!address) return;
    return client.subscribeToTrades(address, (t: TradeRecord) => {
      qc.setQueryData(["trades", address.toLowerCase()], (old: TradeRecord[] | undefined) => {
        if (!old) return [t];
        if (old.some((x) => x.id === t.id)) return old;
        return [t, ...old].slice(0, 80);
      });
      qc.invalidateQueries({ queryKey: ["candles", address.toLowerCase()] });
      qc.invalidateQueries({ queryKey: ["token", address.toLowerCase()] });
    });
  }, [address, qc]);
  return q;
}

export function useCandles(address: string | undefined, interval: CandleInterval) {
  return useQuery({ queryKey: ["candles", address?.toLowerCase(), interval], queryFn: () => client.getCandles(address!, interval, { limit: 400 }) as Promise<Candle[]>, enabled: !!address, refetchInterval: 30_000 });
}

export function useHolders(address?: string) {
  return useQuery({ queryKey: ["holders", address?.toLowerCase()], queryFn: () => client.getHolders(address!, { limit: 11 }), enabled: !!address, refetchInterval: 60_000 });
}

/** USD per ETH, from the factory (Chainlink). */
export function useEthUsd() {
  return useQuery({ queryKey: ["ethUsd"], queryFn: () => client.ethUsd(), staleTime: 60_000, enabled: DEPLOYED });
}

const BAL_ABI = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] }] as const;

/** Native, coin and pair balances for the connected account. */
export function useBalances(account?: Address, token?: Address, pair?: Address) {
  return useQuery({
    queryKey: ["bal", account, token, pair],
    enabled: !!account,
    refetchInterval: 15_000,
    queryFn: async () => {
      const erc = (a: Address) => publicClient.readContract({ address: a, abi: BAL_ABI, functionName: "balanceOf", args: [account!] }) as Promise<bigint>;
      const [native, tok, pr] = await Promise.all([publicClient.getBalance({ address: account! }), token ? erc(token) : 0n, pair ? erc(pair) : 0n]);
      return { native, token: tok, pair: pr };
    },
  });
}

// ---------- toast + tx runner ----------
export type Toast = { kind: "busy" | "ok" | "err"; text: string; hash?: Hash } | null;
type Listener = (t: Toast) => void;
const listeners = new Set<Listener>();
let current: Toast = null;
let timer: ReturnType<typeof setTimeout> | undefined;
export function setToast(t: Toast) {
  current = t;
  listeners.forEach((l) => l(t));
  clearTimeout(timer);
  if (t && t.kind !== "busy") timer = setTimeout(() => setToast(null), 6000);
}
export function useToast(): Toast {
  const [t, setT] = useState<Toast>(current);
  useEffect(() => { listeners.add(setT); return () => { listeners.delete(setT); }; }, []);
  return t;
}

export function friendlyError(err: unknown): string {
  const raw = String((err as any)?.shortMessage ?? (err as any)?.message ?? err);
  if (/user rejected|denied|rejected the request/i.test(raw)) return "Cancelled in wallet.";
  if (/insufficient funds/i.test(raw)) return "Not enough ETH for that.";
  if (/Slippage/i.test(raw)) return "Price moved. Try again.";
  if (/No wallet connected/i.test(raw)) return "Connect a wallet first.";
  if (/LaunchGuard/.test(raw)) return "Launch block: only the creator can buy in the first block.";
  if (/BuyCap|HoldCap/.test(raw)) return "Launch window: max 3% of supply per wallet for the first three blocks.";
  if (/LaunchesPaused/.test(raw)) return "Launches are paused right now.";
  if (/QuoteNotApproved/.test(raw)) return "That pair is not approved.";
  if (/BadRoute/.test(raw)) return "No route for this pair. Pay in the stock instead.";
  if (/NotAdmin/.test(raw)) return "Admin only.";
  if (/ERC20InsufficientAllowance|allowance/i.test(raw)) return "Approve the token first, then retry.";
  if (/ERC20InsufficientBalance|exceeds balance/i.test(raw)) return "Not enough balance.";
  const line = raw.split("\n")[0];
  return line.length > 140 ? line.slice(0, 140) + "…" : line;
}

/** Run a wallet action with toast feedback; resolves true on a mined success. */
export async function runTx(label: string, fn: () => Promise<Hash>, onDone?: (hash: Hash) => void | Promise<void>): Promise<boolean> {
  try {
    setToast({ kind: "busy", text: "Confirm in your wallet" });
    const hash = await fn();
    setToast({ kind: "busy", text: `${label}…`, hash });
    const rc = await publicClient.waitForTransactionReceipt({ hash, timeout: 240_000 });
    if (rc.status !== "success") throw new Error("Transaction reverted");
    await onDone?.(hash);
    setToast({ kind: "ok", text: `${label} done`, hash });
    return true;
  } catch (e) {
    setToast({ kind: "err", text: friendlyError(e) });
    return false;
  }
}
