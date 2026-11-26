import { units } from "./format";
import type { Coin, Pair, PairAsset } from "./types";
import { isNearPair, pairDecimals, pairSymbol } from "./types";

/** Turns pair amounts into the display currency. Token pairs without a
 *  dollar price show in pair units whatever the toggle says. */
export function makeValuer(ccy: "NEAR" | "USD", nearUsd: number, pairUsd: Record<string, number> = {}) {
  return (pair: PairAsset) => {
    const sym = pairSymbol(pair);
    const dec = pairDecimals(pair);
    const px = isNearPair(pair) ? nearUsd : pairUsd[sym] ?? 0;
    const inUsd = ccy === "USD" && px > 0;
    return {
      sym,
      dec,
      unit: inUsd ? "$" : sym,
      /** Display multiplier for one whole pair unit. */
      scale: inUsd ? px : 1,
      /** Formats a raw pair amount. */
      fmt: (raw: string | bigint, compact = false) => {
        const v = units(raw, dec) * (inUsd ? px : 1);
        return inUsd ? money$(v, compact) : `${unitsFmt(v)} ${sym}`;
      },
    };
  };
}

export function money$(v: number, compact = false): string {
  if (!isFinite(v)) return "—";
  if (compact || v >= 1e5) {
    if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
    if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
    if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  }
  if (v === 0) return "$0";
  if (v < 0.01) return `$${v.toFixed(Math.min(10, -Math.floor(Math.log10(v)) + 2))}`;
  if (v < 1) return `$${v.toFixed(4)}`;
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: v >= 1000 ? 0 : 2 })}`;
}

export function unitsFmt(v: number): string {
  if (!isFinite(v)) return "—";
  if (v === 0) return "0";
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e4) return `${(v / 1e3).toFixed(1)}K`;
  if (v < 0.001) return v.toFixed(Math.min(12, -Math.floor(Math.log10(v)) + 2)).replace(/\.?0+$/, "");
  return v.toLocaleString("en-US", { maximumFractionDigits: v < 1 ? 4 : 2 });
}

/** Progress along the curve as tokens sold, 0 to 100. */
export const progress = (c: Coin) => (c.info.phase === "Pool" || c.info.phase === "Graduating" ? 100 : Math.min(100, (units(c.info.tokens_sold, 18) / units(c.info.curve_supply, 18)) * 100));

export const pairKind = (p: PairAsset) => (isNearPair(p) ? "near" : /on$/.test(pairSymbol(p)) ? "stock" : "token");

export const pairName = (pairs: Pair[] | undefined, key: string) => pairs?.find((p) => p.key === key)?.name ?? key;
