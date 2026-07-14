import { Link, useNavigate } from "react-router-dom";
import type { Address, TokenSummary } from "@launchpad/sdk";

import { compact, fmtPct, fmtUsd, fmtWei } from "../lib/format";
import { env } from "../lib/env";
import { MiniChart } from "./MiniChart";
import { TokenLogo } from "./TokenLogo";

/**
 * Premium asset preview card for the discovery feed. Market cap leads,
 * a real mini candle chart shows the market's shape, one action.
 */
export function TokenCard({ token }: { token: TokenSummary }) {
  const navigate = useNavigate();
  const description = String(token.metadata?.description ?? "").trim();

  return (
    <Link
      to={`/token/${token.address}`}
      className="block rounded-2xl border border-edge bg-panel p-5 shadow-[var(--shadow-card)] transition-shadow duration-200 hover:shadow-[var(--shadow-card-hover)] sm:p-6"
    >
      <div className="flex items-start gap-4">
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
        <div className="hidden text-right sm:block">
          <p className="tnum text-[17px] font-semibold text-ink">{fmtUsd(token.marketCapUsd)}</p>
          <p className="text-xs text-ink-3">Market cap</p>
        </div>
      </div>

      <div className="mt-5 flex items-end justify-between gap-4">
        <div className="flex items-end gap-6">
          <MiniChart token={token.address as Address} />
          <dl className="hidden items-end gap-6 sm:flex">
            <div>
              <dd className="tnum text-sm font-semibold text-ink">
                {fmtWei(token.volume24hWei)} {env.nativeSymbol}
              </dd>
              <dt className="text-xs text-ink-3">Volume 24h</dt>
            </div>
            <div>
              <dd className="tnum text-sm font-semibold text-ink">{compact(token.holderCount)}</dd>
              <dt className="text-xs text-ink-3">Holders</dt>
            </div>
            {token.priceChange24hPct != null ? (
              <div>
                <dd
                  className={`tnum text-sm font-semibold ${
                    token.priceChange24hPct >= 0 ? "text-up" : "text-down"
                  }`}
                >
                  {fmtPct(token.priceChange24hPct)}
                </dd>
                <dt className="text-xs text-ink-3">24h</dt>
              </div>
            ) : null}
          </dl>
        </div>

        <div className="flex flex-col items-end gap-2">
          <span className="tnum text-sm font-semibold text-ink sm:hidden">
            {fmtUsd(token.marketCapUsd)}
          </span>
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
      </div>
    </Link>
  );
}
