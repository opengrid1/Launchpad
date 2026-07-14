import { Link, useNavigate } from "react-router-dom";
import type { Address, TokenSummary } from "@launchpad/sdk";

import { compact, fmtPct, fmtUsd, fmtWeiUsd, shortAddr, usdRateOf } from "../lib/format";
import { MiniChart } from "./MiniChart";
import { TokenLogo } from "./TokenLogo";

/**
 * Premium asset preview card for the discovery feed. Market cap leads, a
 * real mini candle chart shows the market's shape, key stats and graduation
 * progress stay visible on every screen size, one action.
 */
export function TokenCard({ token }: { token: TokenSummary }) {
  const navigate = useNavigate();
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
            <span className="text-sm font-medium text-ink-3">{token.symbol}</span>
          </div>
          {description ? (
            <p className="mt-0.5 line-clamp-1 text-sm text-ink-2">{description}</p>
          ) : (
            <p className="mt-0.5 text-sm text-ink-3">No description</p>
          )}
        </div>
        <div className="text-right">
          <p className="tnum text-[17px] font-semibold text-ink">{fmtUsd(token.marketCapUsd)}</p>
          <p className="text-xs text-ink-3">Market cap</p>
        </div>
      </div>

      {/* Chart + stats, visible on all screens */}
      <div className="mt-4 flex items-end gap-5">
        <MiniChart token={token.address as Address} />
        <dl className="flex flex-1 flex-wrap items-end justify-end gap-x-6 gap-y-2">
          <div className="text-right">
            <dd className="tnum text-sm font-semibold text-ink">
              {fmtWeiUsd(token.volume24hWei, usdRate)}
            </dd>
            <dt className="text-[11px] text-ink-3">Volume 24h</dt>
          </div>
          <div className="text-right">
            <dd className="tnum text-sm font-semibold text-ink">{compact(token.holderCount)}</dd>
            <dt className="text-[11px] text-ink-3">Holders</dt>
          </div>
          {token.priceChange24hPct != null ? (
            <div className="text-right">
              <dd
                className={`tnum text-sm font-semibold ${
                  token.priceChange24hPct >= 0 ? "text-up" : "text-down"
                }`}
              >
                {fmtPct(token.priceChange24hPct)}
              </dd>
              <dt className="text-[11px] text-ink-3">24h</dt>
            </div>
          ) : null}
        </dl>
      </div>

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
        <p className="text-xs text-ink-3">
          by <span className="tnum text-ink-2">{shortAddr(token.creator)}</span>
        </p>
        <button
          onClick={(e) => {
            e.preventDefault();
            navigate(`/token/${token.address}`);
          }}
          className="h-10 rounded-full bg-accent px-6 text-sm font-semibold text-ink transition-colors hover:bg-accent-2"
        >
          Trade
        </button>
      </div>
    </Link>
  );
}
