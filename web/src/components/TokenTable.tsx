import { Link } from "react-router-dom";
import type { TokenSummary } from "@launchpad/sdk";

import { fmtPct, fmtUsd, fmtWei, compact } from "../lib/format";
import { env } from "../lib/env";
import { Badge, EmptyState, Skeleton } from "./ui";

export function TokenLogo({ token, size = 32 }: { token: TokenSummary; size?: number }) {
  const logo = token.metadata?.logo;
  if (logo && /^(https?:|ipfs:|data:)/.test(String(logo))) {
    const src = String(logo).startsWith("ipfs://")
      ? `https://ipfs.io/ipfs/${String(logo).slice(7)}`
      : String(logo);
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        className="rounded-full bg-panel-2 object-cover"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
    );
  }
  return (
    <span
      className="grid place-items-center rounded-full bg-panel-2 font-semibold text-ink-2"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {token.symbol.slice(0, 2).toUpperCase()}
    </span>
  );
}

export function TokenTable({
  tokens,
  loading,
}: {
  tokens: TokenSummary[] | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="space-y-2 p-4">
        {[...Array(6)].map((_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    );
  }
  if (!tokens || tokens.length === 0) {
    return (
      <EmptyState
        title="No tokens launched yet"
        body="Be the first. Launching deploys a real ERC-20 with a live Uniswap V3 pool in one transaction."
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead>
          <tr className="border-b border-edge text-[10px] uppercase tracking-wider text-ink-3">
            <th className="px-4 py-2.5 font-medium">Token</th>
            <th className="tnum px-2 py-2.5 text-right font-medium">Price</th>
            <th className="tnum px-2 py-2.5 text-right font-medium">24h</th>
            <th className="tnum px-2 py-2.5 text-right font-medium">Market cap</th>
            <th className="tnum px-2 py-2.5 text-right font-medium">Liquidity</th>
            <th className="tnum px-2 py-2.5 text-right font-medium">24h volume</th>
            <th className="tnum px-2 py-2.5 text-right font-medium">Holders</th>
            <th className="px-4 py-2.5 text-right font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {tokens.map((t) => (
            <tr key={t.address} className="group border-b border-edge/50 hover:bg-panel-2/50">
              <td className="px-4 py-3">
                <Link to={`/t/${t.address}`} className="flex items-center gap-3">
                  <TokenLogo token={t} />
                  <span>
                    <span className="flex items-center gap-2 font-semibold text-ink group-hover:text-accent-2">
                      {t.symbol}
                      {t.featured ? <Badge tone="accent">Featured</Badge> : null}
                    </span>
                    <span className="block text-xs text-ink-3">{t.name}</span>
                  </span>
                </Link>
              </td>
              <td className="tnum px-2 py-3 text-right text-ink-2">{fmtUsd(t.priceUsd)}</td>
              <td
                className={`tnum px-2 py-3 text-right font-medium ${
                  t.priceChange24hPct == null
                    ? "text-ink-3"
                    : t.priceChange24hPct >= 0
                      ? "text-up"
                      : "text-down"
                }`}
              >
                {fmtPct(t.priceChange24hPct)}
              </td>
              <td className="tnum px-2 py-3 text-right text-ink-2">{fmtUsd(t.marketCapUsd)}</td>
              <td className="tnum px-2 py-3 text-right text-ink-2">
                {fmtWei(t.liquidityWei)} {env.nativeSymbol}
              </td>
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
  );
}
