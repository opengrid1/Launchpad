import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Candle, CandleInterval, TradeRecord } from "@launchpad/sdk";
import type { Address, Hash } from "viem";
import { useAccount } from "wagmi";

import { client, onair, publicClient, type OnairToken } from "./client";
import { ADDRESSES } from "./env";

export type Token = OnairToken;

export function useTokens() {
  return useQuery({
    queryKey: ["tokens"],
    queryFn: () => client.getTokens({ sort: "new", limit: 120 }),
    refetchInterval: 20_000,
    staleTime: 8_000,
  });
}

export function useToken(address?: string) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["token", address?.toLowerCase()],
    queryFn: () => client.getToken(address!),
    enabled: !!address,
    refetchInterval: 30_000,
  });
  // live price ticks patch the cached summary in place (pool-backed coins only)
  useEffect(() => {
    if (!address) return;
    return client.subscribeToPrice(address, (u) => {
      qc.setQueryData(["token", address.toLowerCase()], (old: Token | null | undefined) =>
        old && !(old.auction && !old.auction.finalized)
          ? { ...old, priceWei: u.priceWei, priceUsd: u.priceUsd, marketCapUsd: u.marketCapUsd, liquidityWei: u.liquidityWei, volume24hWei: u.volume24hWei ?? old.volume24hWei, txCount24h: u.txCount24h ?? old.txCount24h, holderCount: u.holderCount ?? old.holderCount }
          : old,
      );
    });
  }, [address, qc]);
  return q;
}

/** Live auction state for a coin; polls fast while the auction runs. */
export function useAuction(address?: Address, enabled = true) {
  return useQuery({
    queryKey: ["auction", address?.toLowerCase()],
    queryFn: () => onair.auction(address!),
    enabled: !!address && enabled,
    refetchInterval: (q) => (q.state.data && q.state.data.open ? 6_000 : 30_000),
  });
}

export function useBids(address?: Address, owner?: Address) {
  return useQuery({
    queryKey: ["bids", address?.toLowerCase(), owner?.toLowerCase() ?? "all"],
    queryFn: () => onair.bids(address!, { owner, limit: owner ? 50 : 100 }),
    enabled: !!address,
    refetchInterval: 12_000,
  });
}

export function useCheckpoints(address?: Address) {
  return useQuery({
    queryKey: ["checkpoints", address?.toLowerCase()],
    queryFn: () => onair.checkpoints(address!),
    enabled: !!address,
    refetchInterval: 15_000,
  });
}

/** Factory settings: auction config, floor, HYPE price, owner. */
export function useConfig() {
  return useQuery({ queryKey: ["config"], queryFn: () => onair.config(), staleTime: 60_000 });
}

/** True when the connected wallet owns the factory. */
export function useIsOwner() {
  const { address } = useAccount();
  const { data } = useConfig();
  return !!address && !!data && data.owner.toLowerCase() === address.toLowerCase();
}

export function useTrades(address?: string) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["trades", address?.toLowerCase()],
    queryFn: () => client.getTrades(address!, { limit: 60 }),
    enabled: !!address,
    refetchInterval: 30_000,
  });
  useEffect(() => {
    if (!address) return;
    return client.subscribeToTrades(address, (t: TradeRecord) => {
      qc.setQueryData(["trades", address.toLowerCase()], (old: TradeRecord[] | undefined) => {
        if (!old) return [t];
        if (old.some((x) => x.id === t.id)) return old;
        return [t, ...old].slice(0, 80);
      });
      qc.invalidateQueries({ queryKey: ["candles", address.toLowerCase()] });
    });
  }, [address, qc]);
  return q;
}

export function useCandles(address: string | undefined, interval: CandleInterval) {
  return useQuery({
    queryKey: ["candles", address?.toLowerCase(), interval],
    queryFn: () => client.getCandles(address!, interval, { limit: 400 }) as Promise<Candle[]>,
    enabled: !!address,
    refetchInterval: 30_000,
  });
}

export function useHolders(address?: string) {
  return useQuery({
    queryKey: ["holders", address?.toLowerCase()],
    queryFn: () => client.getHolders(address!, { limit: 30 }),
    enabled: !!address,
    refetchInterval: 60_000,
  });
}

/** USD per HYPE, from the factory's quote registry. */
export function useHypeUsd() {
  return useQuery({ queryKey: ["hypeUsd"], queryFn: () => client.assetUsdPrice(ADDRESSES.quote), staleTime: 60_000 });
}

/** Native + token balances for the connected account. */
export function useBalances(account?: Address, token?: Address) {
  return useQuery({
    queryKey: ["bal", account, token],
    enabled: !!account,
    refetchInterval: 15_000,
    queryFn: async () => {
      const native = await publicClient.getBalance({ address: account! });
      const tok = token
        ? ((await publicClient.readContract({
            address: token,
            abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] }],
            functionName: "balanceOf",
            args: [account!],
          })) as bigint)
        : 0n;
      return { native, token: tok };
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
  if (/insufficient funds/i.test(raw)) return "Not enough HYPE for that.";
  if (/Too little received|amountOutMinimum|slippage/i.test(raw)) return "Price moved. Try again or raise slippage.";
  if (/No wallet connected/i.test(raw)) return "Connect a wallet first.";
  if (/BelowClearing/.test(raw)) return "Your max price is under the clearing price. Raise it.";
  if (/BidTooSmall/.test(raw)) return "Bid is under the minimum.";
  if (/NotOnGrid/.test(raw)) return "Max price is off the auction's grid.";
  if (/AuctionOver/.test(raw)) return "This auction has ended.";
  if (/AuctionRunning/.test(raw)) return "The auction is still running.";
  if (/NotFinalized/.test(raw)) return "Not settled yet. Finalize first.";
  if (/AlreadyExited/.test(raw)) return "Already claimed.";
  if (/LaunchesArePaused/.test(raw)) return "Launches are paused right now.";
  if (/PoolTampered/.test(raw)) return "Pool price could not be restored. Try again.";
  if (/exceeds block gas limit|gas limit/i.test(raw)) return "Needs big blocks. Turn them on in the Hyperliquid app, then retry.";
  const line = raw.split("\n")[0];
  return line.length > 140 ? line.slice(0, 140) + "…" : line;
}

/** Run a wallet action with toast feedback; resolves true on a mined success. */
export async function runTx(label: string, fn: () => Promise<Hash>, onDone?: (hash: Hash) => void | Promise<void>): Promise<boolean> {
  try {
    setToast({ kind: "busy", text: "Confirm in your wallet" });
    const hash = await fn();
    setToast({ kind: "busy", text: `${label}…`, hash });
    const rc = await publicClient.waitForTransactionReceipt({ hash });
    if (rc.status !== "success") throw new Error("Transaction reverted");
    await onDone?.(hash);
    setToast({ kind: "ok", text: `${label} done`, hash });
    return true;
  } catch (e) {
    setToast({ kind: "err", text: friendlyError(e) });
    return false;
  }
}
