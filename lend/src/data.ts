import { useQuery } from "@tanstack/react-query";
import { createPublicClient, http, type Address } from "viem";

import { ERC20_ABI, MARKET_ABI, ORACLE_ABI } from "./abi";
import { CHAIN, MARKET, ORACLE, RPC, STOCKS, USDG, type StockDef } from "./config";

export const publicClient = createPublicClient({ chain: CHAIN, transport: http(RPC, { batch: true }) });

export const WAD = 10n ** 18n;
export const BPS = 10_000n;
export const USDG_TO_WAD = 10n ** 12n;

export interface MarketData extends StockDef {
  cash: bigint;
  totalBorrows: bigint;
  totalReserves: bigint;
  totalShares: bigint;
  supplyCap: bigint;
  borrowCap: bigint;
  borrowsPaused: boolean;
  rate: { base: number; slope1: number; slope2: number; kink: number }; // bps
  risk: { ltv: number; liq: number; liqBonus: number; reserve: number }; // bps
  borrowBps: number;
  supplyBps: number;
  exchangeRate: bigint; // WAD
  twap: bigint | null; // WAD USD per 1e18 raw; null when the oracle reverts
  spot: bigint | null;
  util: number; // 0..1
  // user
  shares: bigint;
  supplied: bigint; // raw stock = shares * xr
  debt: bigint; // raw stock
  balance: bigint;
  allowance: bigint;
}

export interface AccountData {
  collateral: bigint; // USDG 6-dec
  usdgBalance: bigint;
  usdgAllowance: bigint;
  collateralUsd: bigint; // WAD
  debtUsd: bigint;
  borrowLimitUsed: bigint;
  liqLimitUsed: bigint;
  healthFactor: bigint | null; // WAD, null = no debt
  liquidityError: string | null; // set when accountLiquidity reverted (oracle guard)
}

export interface Protocol {
  markets: MarketData[];
  account: AccountData | null;
  fetchedAt: number;
}

const ZERO: AccountData = {
  collateral: 0n, usdgBalance: 0n, usdgAllowance: 0n, collateralUsd: 0n, debtUsd: 0n, borrowLimitUsed: 0n, liqLimitUsed: 0n, healthFactor: null, liquidityError: null,
};

export async function fetchProtocol(user?: Address): Promise<Protocol> {
  const calls: any[] = [];
  for (const s of STOCKS) {
    calls.push(
      { address: MARKET, abi: MARKET_ABI, functionName: "market", args: [s.address] },
      { address: MARKET, abi: MARKET_ABI, functionName: "borrowRateBps", args: [s.address] },
      { address: MARKET, abi: MARKET_ABI, functionName: "supplyRateBps", args: [s.address] },
      { address: MARKET, abi: MARKET_ABI, functionName: "exchangeRate", args: [s.address] },
      { address: ORACLE, abi: ORACLE_ABI, functionName: "peek", args: [s.address] },
    );
    if (user) {
      calls.push(
        { address: MARKET, abi: MARKET_ABI, functionName: "shares", args: [s.address, user] },
        { address: MARKET, abi: MARKET_ABI, functionName: "borrowBalance", args: [s.address, user] },
        { address: s.address, abi: ERC20_ABI, functionName: "balanceOf", args: [user] },
        { address: s.address, abi: ERC20_ABI, functionName: "allowance", args: [user, MARKET] },
      );
    }
  }
  if (user) {
    calls.push(
      { address: MARKET, abi: MARKET_ABI, functionName: "collateral", args: [user] },
      { address: MARKET, abi: MARKET_ABI, functionName: "accountLiquidity", args: [user] },
      { address: MARKET, abi: MARKET_ABI, functionName: "healthFactor", args: [user] },
      { address: USDG, abi: ERC20_ABI, functionName: "balanceOf", args: [user] },
      { address: USDG, abi: ERC20_ABI, functionName: "allowance", args: [user, MARKET] },
    );
  }
  const res = await publicClient.multicall({ contracts: calls, allowFailure: true });
  let i = 0;
  const next = () => res[i++];
  const val = <T,>(r: any, fallback: T): T => (r.status === "success" ? (r.result as T) : fallback);

  const markets: MarketData[] = STOCKS.map((s) => {
    const m = val<any>(next(), null);
    const borrowBps = Number(val<bigint>(next(), 0n));
    const supplyBps = Number(val<bigint>(next(), 0n));
    const exchangeRate = val<bigint>(next(), WAD);
    const peek = next();
    const twap = peek.status === "success" ? (peek.result as [bigint, bigint])[0] : null;
    const spot = peek.status === "success" ? (peek.result as [bigint, bigint])[1] : null;
    let shares = 0n, debt = 0n, balance = 0n, allowance = 0n;
    if (user) {
      shares = val<bigint>(next(), 0n);
      debt = val<bigint>(next(), 0n);
      balance = val<bigint>(next(), 0n);
      allowance = val<bigint>(next(), 0n);
    }
    const cash: bigint = m?.cash ?? 0n, totalBorrows: bigint = m?.totalBorrows ?? 0n;
    const total = cash + totalBorrows;
    return {
      ...s,
      cash, totalBorrows,
      totalReserves: m?.totalReserves ?? 0n,
      totalShares: m?.totalShares ?? 0n,
      supplyCap: m?.supplyCap ?? 0n,
      borrowCap: m?.borrowCap ?? 0n,
      borrowsPaused: m?.borrowsPaused ?? false,
      rate: { base: Number(m?.rate?.baseRateBps ?? 0n), slope1: Number(m?.rate?.slope1Bps ?? 0n), slope2: Number(m?.rate?.slope2Bps ?? 0n), kink: Number(m?.rate?.kinkBps ?? 8000n) },
      risk: { ltv: Number(m?.risk?.ltvBps ?? 5000), liq: Number(m?.risk?.liqThresholdBps ?? 6500), liqBonus: Number(m?.risk?.liqBonusBps ?? 800), reserve: Number(m?.risk?.reserveFactorBps ?? 1500) },
      borrowBps, supplyBps, exchangeRate, twap, spot,
      util: total === 0n ? 0 : Number((totalBorrows * 10_000n) / total) / 10_000,
      shares, supplied: (shares * exchangeRate) / WAD, debt, balance, allowance,
    };
  });

  let account: AccountData | null = null;
  if (user) {
    const collateral = val<bigint>(next(), 0n);
    const liq = next();
    const hf = next();
    const usdgBalance = val<bigint>(next(), 0n);
    const usdgAllowance = val<bigint>(next(), 0n);
    account = { ...ZERO, collateral, usdgBalance, usdgAllowance, collateralUsd: collateral * USDG_TO_WAD };
    if (liq.status === "success") {
      const [c, d, b, l] = liq.result as [bigint, bigint, bigint, bigint];
      account.collateralUsd = c; account.debtUsd = d; account.borrowLimitUsed = b; account.liqLimitUsed = l;
    } else {
      account.liquidityError = errorName(liq.error) ?? "oracle unavailable";
    }
    if (hf.status === "success") {
      const v = hf.result as bigint;
      account.healthFactor = v === 2n ** 256n - 1n ? null : v;
    }
  }
  return { markets, account, fetchedAt: Date.now() };
}

export function useProtocol(user?: Address) {
  return useQuery({ queryKey: ["protocol", user ?? "-"], queryFn: () => fetchProtocol(user), refetchInterval: 15_000, staleTime: 5_000 });
}

/** Pull the custom-error name out of a viem error, if any. */
export function errorName(err: unknown): string | null {
  const e = err as any;
  const n = e?.cause?.data?.errorName ?? e?.data?.errorName ?? e?.cause?.cause?.data?.errorName;
  if (n) return n;
  const msg = String(e?.shortMessage ?? e?.message ?? "");
  const m = msg.match(/Error: (\w+)\(/) ?? msg.match(/reverted with the following reason:\s*(\S+)/);
  return m ? m[1] : null;
}

// ---------- pure math mirrors of the contract, for previews ----------

export function borrowAprBps(m: MarketData, util: number): number {
  const kink = m.rate.kink / 10_000;
  if (util <= kink) return m.rate.base + (m.rate.slope1 * util) / kink;
  return m.rate.base + m.rate.slope1 + (m.rate.slope2 * (util - kink)) / (1 - kink);
}
export function supplyApyBps(m: MarketData, util: number): number {
  return (borrowAprBps(m, util) * util * (10_000 - m.risk.reserve)) / 10_000;
}
