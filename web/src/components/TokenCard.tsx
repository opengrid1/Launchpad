import { memo } from "react";
import { Link } from "react-router-dom";
import type { TokenSummary } from "@launchpad/sdk";

import { fmtPct, fmtUsd, shortAddr, timeAgo } from "../lib/format";

/**
 * Token tile for the discovery grid: a square artwork, the identity, the
 * market cap that leads, and a 24h badge. Memoized so a feed refresh only
 * repaints tiles whose live numbers actually changed.
 */
function TokenCardBase({ token }: { token: TokenSummary }) {
  const logo = token.metadata?.logo;
  const hasLogo = logo && /^(https?:|ipfs:|data:)/.test(String(logo));
  const src = hasLogo
    ? String(logo).startsWith("ipfs://")
      ? `https://ipfs.io/ipfs/${String(logo).slice(7)}`
      : String(logo)
    : null;
  const change = token.priceChange24hPct;

  return (
    <Link
      to={`/token/${token.address}`}
      className="group block rounded-2xl border border-edge bg-panel p-3 transition-all hover:border-edge-2 hover:shadow-[var(--shadow-card-hover)]"
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-panel-2">
        {src ? (
          <img
            src={src}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-3xl font-bold text-ink-3">
            {token.symbol.slice(0, 3).toUpperCase()}
          </div>
        )}
        {change != null ? (
          <span
            className={`tnum absolute left-2 top-2 rounded-full px-2 py-0.5 text-[11px] font-semibold backdrop-blur ${
              change >= 0 ? "bg-up/15 text-up" : "bg-down/15 text-down"
            }`}
          >
            {fmtPct(change)}
          </span>
        ) : null}
      </div>

      <div className="mt-3">
        <p className="truncate text-[15px] font-semibold text-ink">{token.name}</p>
        <p className="tnum text-xs text-ink-3">${token.symbol}</p>
      </div>

      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="tnum text-[17px] font-bold tracking-tight text-ink">
          {fmtUsd(token.marketCapUsd)}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wide text-ink-3">MC</span>
      </div>

      <div className="mt-2.5 flex items-center justify-between border-t border-edge pt-2.5 font-mono text-[11px] text-ink-3">
        <span className="tnum">{shortAddr(token.creator)}</span>
        <span>{timeAgo(token.createdAt)}</span>
      </div>
    </Link>
  );
}

export const TokenCard = memo(
  TokenCardBase,
  (a, b) =>
    a.token.address === b.token.address &&
    a.token.name === b.token.name &&
    a.token.symbol === b.token.symbol &&
    a.token.marketCapUsd === b.token.marketCapUsd &&
    a.token.priceChange24hPct === b.token.priceChange24hPct &&
    a.token.createdAt === b.token.createdAt &&
    a.token.metadata?.logo === b.token.metadata?.logo,
);
