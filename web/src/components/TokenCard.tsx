import { memo } from "react";
import { Link } from "react-router-dom";
import type { TokenSummary } from "@launchpad/sdk";

import { compact, fmtPct, fmtUsd, fmtWeiUsd, shortAddr, usdRateOf } from "../lib/format";
import { TokenLogo } from "./TokenLogo";

/**
 * Premium asset preview card for the discovery feed. Market cap leads, key
 * stats stay visible on every screen size, one action. Memoized so a feed
 * refresh only repaints the cards whose live numbers actually changed.
 */
function TokenCardBase({ token }: { token: TokenSummary }) {
  const description = String(token.metadata?.description ?? "").trim();

  const usdRate = usdRateOf(token);
  const mcap = Number(token.marketCapUsd);
  const remaining = Number(token.remainingToGraduationUsd);
  const cap = mcap + remaining;
  const progress = cap > 0 ? Math.min((mcap / cap) * 100, 100) : 0;

  return (
    <Link
      to={`/token/${token.address}`}
      className="block rounded-2xl border border-edge bg-panel p-5 shadow-[var(--shadow-card)] transition-shadow duration-200 hover:shadow-[var(--shadow-card-hover)] sm:p-6"
    >
      {/* Identity + market cap */}
      <div className="flex items-start gap-3.5">
        <TokenLogo token={token} size={48} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h3 className="truncate text-[17px] font-semibold tracking-tight text-ink">
              {token.name}
            </h3>
            <span className="tnum text-sm font-medium text-ink-3">${token.symbol}</span>
            <span className="hidden shrink-0 rounded-full bg-panel-2 px-2 py-0.5 text-[10px] font-medium text-ink-2 sm:inline-block">
              Uniswap V3
            </span>
          </div>
          {description ? (
            <p className="mt-0.5 line-clamp-1 text-sm text-ink-2">{description}</p>
          ) : (
            <p className="mt-0.5 text-sm text-ink-3">No description</p>
          )}
        </div>
      </div>

      {/* Stats, one aligned row */}
      <dl className="mt-4 grid grid-cols-4 gap-3">
        <div>
          <dd className="tnum text-sm font-semibold text-ink">{fmtUsd(token.marketCapUsd)}</dd>
          <dt className="mt-0.5 text-[11px] text-ink-3">Market cap</dt>
        </div>
        <div>
          <dd className="tnum text-sm font-semibold text-ink">
            {fmtWeiUsd(token.volume24hWei, usdRate)}
          </dd>
          <dt className="mt-0.5 text-[11px] text-ink-3">Volume 24h</dt>
        </div>
        <div>
          <dd className="tnum text-sm font-semibold text-ink">{compact(token.holderCount)}</dd>
          <dt className="mt-0.5 text-[11px] text-ink-3">Holders</dt>
        </div>
        <div>
          <dd
            className={`tnum text-sm font-semibold ${
              token.priceChange24hPct == null
                ? "text-ink-3"
                : token.priceChange24hPct >= 0
                  ? "text-up"
                  : "text-down"
            }`}
          >
            {token.priceChange24hPct == null ? "-" : fmtPct(token.priceChange24hPct)}
          </dd>
          <dt className="mt-0.5 text-[11px] text-ink-3">24h</dt>
        </div>
      </dl>

      {/* Graduation progress */}
      {token.limitsActive ? (
        <div className="mt-4">
          <div className="h-1.5 overflow-hidden rounded-full bg-panel-2">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-500"
              style={{ width: `${Math.max(progress, 1.5)}%` }}
            />
          </div>
          <p className="tnum mt-1.5 text-[11px] text-ink-3">
            {progress.toFixed(1)}% to open trading at {fmtUsd(cap)}
          </p>
        </div>
      ) : (
        <p className="mt-4 text-[11px] font-medium text-up">Graduated, trading is unrestricted</p>
      )}

      {/* Creator + action */}
      <div className="mt-3 flex items-center justify-between border-t border-edge pt-3.5">
        <p className="flex items-center gap-2 text-xs text-ink-3">
          by <span className="tnum text-ink-2">{shortAddr(token.creator)}</span>
          <span className="rounded-full bg-panel-2 px-2 py-0.5 text-[10px] font-medium text-ink-2 sm:hidden">
            Uniswap V3
          </span>
        </p>
      </div>
    </Link>
  );
}

/**
 * A feed refresh replaces the token array on every poll, but most cards carry
 * identical live numbers tick to tick. Repaint only when a field this card
 * actually renders has changed, so scrolling stays at 60 FPS.
 */
export const TokenCard = memo(
  TokenCardBase,
  (a, b) =>
    a.token.address === b.token.address &&
    a.token.name === b.token.name &&
    a.token.symbol === b.token.symbol &&
    a.token.marketCapUsd === b.token.marketCapUsd &&
    a.token.volume24hWei === b.token.volume24hWei &&
    a.token.holderCount === b.token.holderCount &&
    a.token.priceChange24hPct === b.token.priceChange24hPct &&
    a.token.remainingToGraduationUsd === b.token.remainingToGraduationUsd &&
    a.token.limitsActive === b.token.limitsActive &&
    a.token.featured === b.token.featured &&
    a.token.metadata?.description === b.token.metadata?.description &&
    a.token.metadata?.logo === b.token.metadata?.logo,
);
