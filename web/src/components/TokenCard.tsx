import { memo } from "react";
import { Link } from "react-router-dom";
import type { TokenSummary } from "@launchpad/sdk";

import { fmtPct, fmtUsd, fmtWeiUsd, usdRateOf } from "../lib/format";
import { MiniChart } from "./MiniChart";
import { StockLogo } from "./StockLogo";
import { stockOf } from "../lib/v4/stocks";
import { stockSOf } from "../lib/v4s/stocks";

/** Reward stocks the token prints — the v4s basket, or the single v4 stock. */
function RewardChips({ token }: { token: TokenSummary }) {
  const meta = token.metadata as any;
  const addrs: string[] = Array.isArray(meta?.rewardBasket)
    ? meta.rewardBasket
    : meta?.rewardStock
      ? [meta.rewardStock]
      : [];
  const stocks = addrs
    .map((a) => stockOf(a) ?? stockSOf(a))
    .filter((s): s is NonNullable<typeof s> => !!s);
  if (!stocks.length) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] font-medium text-ink-3">Prints</span>
      {stocks.map((s) => (
        <span
          key={s.address}
          title={s.name}
          className="flex items-center gap-1 rounded-full border border-accent/30 bg-accent/[0.07] py-0.5 pl-0.5 pr-1.5 text-[10.5px] font-bold text-accent-ink"
        >
          <StockLogo address={s.address} symbol={s.symbol} size={14} />
          {s.symbol}
        </span>
      ))}
    </div>
  );
}

function Artwork({ token, size = 48 }: { token: TokenSummary; size?: number }) {
  const logo = token.metadata?.logo;
  const ok = logo && /^(https?:|ipfs:|data:)/.test(String(logo));
  const src = ok
    ? String(logo).startsWith("ipfs://")
      ? `https://ipfs.io/ipfs/${String(logo).slice(7)}`
      : String(logo)
    : null;
  return (
    <div
      className="grid shrink-0 place-items-center overflow-hidden rounded-2xl bg-panel-2 text-sm font-bold text-ink-3"
      style={{ width: size, height: size }}
    >
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
        token.symbol.slice(0, 3).toUpperCase()
      )}
    </div>
  );
}

/**
 * Discovery card. One glance gives the identity, the market cap, the shape of
 * the market and the day's volume, with a single clear action. The whole card
 * is the link; the Trade pill is the visual affordance. Memoized so a live
 * feed refresh only repaints cards whose numbers moved.
 */
function TokenCardBase({ token }: { token: TokenSummary }) {
  const rate = usdRateOf(token);
  const change = token.priceChange24hPct;

  return (
    <Link
      to={`/token/${token.address}`}
      className="group flex flex-col rounded-[26px] border border-edge bg-panel p-5 shadow-[var(--shadow-card)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-card-hover)]"
    >
      <div className="flex items-center gap-3.5">
        <Artwork token={token} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-semibold leading-tight text-ink">{token.name}</p>
          <p className="tnum text-[13px] text-ink-3">${token.symbol}</p>
        </div>
        <span
          className={`tnum shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold ${
            change == null ? "bg-panel-2 text-ink-3" : change >= 0 ? "bg-up/10 text-up" : "bg-down/10 text-down"
          }`}
        >
          {change == null ? "—" : fmtPct(change)}
        </span>
      </div>

      <RewardChips token={token} />

      <div className="mt-5 flex items-end justify-between gap-3">
        <div>
          <p className="tnum text-[26px] font-semibold leading-none tracking-tight text-ink">
            {fmtUsd(token.marketCapUsd)}
          </p>
          <p className="mt-1.5 text-[12px] text-ink-3">Market cap</p>
        </div>
        <MiniChart token={token.address} />
      </div>

      <div className="mt-5 flex items-center justify-between border-t border-edge pt-4">
        <div>
          <p className="tnum text-[14px] font-semibold text-ink">{fmtWeiUsd(token.volume24hWei, rate)}</p>
          <p className="text-[11px] text-ink-3">Volume 24h</p>
        </div>
        <span className="rounded-full bg-accent px-5 py-2 text-[13px] font-bold text-black shadow-[var(--shadow-btn)] transition-transform group-hover:scale-[1.03]">
          Trade
        </span>
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
    a.token.volume24hWei === b.token.volume24hWei &&
    a.token.priceChange24hPct === b.token.priceChange24hPct &&
    a.token.metadata?.logo === b.token.metadata?.logo &&
    JSON.stringify((a.token.metadata as any)?.rewardBasket ?? (a.token.metadata as any)?.rewardStock) ===
      JSON.stringify((b.token.metadata as any)?.rewardBasket ?? (b.token.metadata as any)?.rewardStock),
);
