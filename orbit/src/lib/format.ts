export const short = (a: string, n = 4) => (a ? `${a.slice(0, n + 2)}…${a.slice(-n)}` : "");

export function usd(v: number | string, opts?: { compact?: boolean }): string {
  const x = typeof v === "string" ? Number(v) : v;
  if (!isFinite(x)) return "—";
  if (opts?.compact) {
    if (Math.abs(x) >= 1e9) return `$${(x / 1e9).toFixed(2)}B`;
    if (Math.abs(x) >= 1e6) return `$${(x / 1e6).toFixed(2)}M`;
    if (Math.abs(x) >= 1e4) return `$${(x / 1e3).toFixed(1)}K`;
  }
  if (x === 0) return "$0";
  if (Math.abs(x) < 0.01) return `$${x.toPrecision(3)}`;
  if (Math.abs(x) < 1) return `$${x.toFixed(4)}`;
  return `$${x.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: x >= 1000 ? 0 : 2 })}`;
}

export function num(x: number, d = 2): string {
  if (!isFinite(x)) return "—";
  if (Math.abs(x) >= 1e9) return `${(x / 1e9).toFixed(2)}B`;
  if (Math.abs(x) >= 1e6) return `${(x / 1e6).toFixed(2)}M`;
  if (Math.abs(x) >= 1e4) return `${(x / 1e3).toFixed(1)}K`;
  return x.toLocaleString("en-US", { maximumFractionDigits: d });
}

export const wei = (s: string | bigint, d = 18) => Number(typeof s === "bigint" ? s : BigInt(s || "0")) / 10 ** d;

export function hype(v: number, d = 3): string {
  if (!isFinite(v)) return "—";
  if (v === 0) return "0";
  if (v < 0.001) return v.toPrecision(2);
  return v.toLocaleString("en-US", { maximumFractionDigits: d });
}

export function pct(v: number | null | undefined, sign = true): string {
  if (v == null || !isFinite(v)) return "—";
  return `${sign && v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}

export function ago(ts: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function dateShort(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
