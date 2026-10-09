export const short = (a: string, n = 8) => (a.length > n * 2 + 3 ? `${a.slice(0, n)}…${a.slice(-n)}` : a);

/** Big-integer string in `d` decimals to a number. */
export const units = (s: string | bigint | undefined, d: number) => {
  if (s == null) return 0;
  const b = typeof s === "bigint" ? s : BigInt(s || "0");
  const base = 10n ** BigInt(d);
  const whole = b / base;
  const frac = b % base;
  return Number(whole) + Number(frac) / Number(base);
};

/** A decimal string typed by a person to raw units. */
export function toUnits(v: string, d: number): bigint {
  const s = (v || "0").trim();
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") return 0n;
  const [w, f = ""] = s.split(".");
  const frac = (f + "0".repeat(d)).slice(0, d);
  return BigInt(w || "0") * 10n ** BigInt(d) + BigInt(frac || "0");
}

export function usd(v: number, opts?: { compact?: boolean }): string {
  if (!isFinite(v)) return "—";
  if (opts?.compact) {
    if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
    if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
    if (Math.abs(v) >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  }
  if (v === 0) return "$0";
  if (Math.abs(v) < 0.01) return `$${v.toPrecision(3)}`;
  if (Math.abs(v) < 1) return `$${v.toFixed(4)}`;
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: v >= 1000 ? 0 : 2 })}`;
}

export function num(x: number, d = 2): string {
  if (!isFinite(x)) return "—";
  if (Math.abs(x) >= 1e9) return `${(x / 1e9).toFixed(2)}B`;
  if (Math.abs(x) >= 1e6) return `${(x / 1e6).toFixed(2)}M`;
  if (Math.abs(x) >= 1e4) return `${(x / 1e3).toFixed(1)}K`;
  return x.toLocaleString("en-US", { maximumFractionDigits: d });
}

/** Pair amounts: never exponent notation, trims trailing zeros. */
export function amt(v: number, d = 4): string {
  if (!isFinite(v)) return "—";
  if (v === 0) return "0";
  if (Math.abs(v) < 0.001) return v.toFixed(Math.min(12, -Math.floor(Math.log10(Math.abs(v))) + 2)).replace(/\.?0+$/, "");
  if (Math.abs(v) >= 1e6) return num(v);
  return v.toLocaleString("en-US", { maximumFractionDigits: d });
}

export function pct(v: number | null | undefined, sign = true): string {
  if (v == null || !isFinite(v)) return "—";
  return `${sign && v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function dateShort(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
