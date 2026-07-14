import type { TokenSummary } from "@launchpad/sdk";

import { fmtTokens, fmtUsd } from "../lib/format";
import { Badge, Card, CardHeader } from "./ui";

/**
 * Anti-whale status: current restrictions, market cap progress toward the
 * graduation threshold, and the protocol liquidity disclosure.
 */
export function LimitsCard({ token }: { token: TokenSummary & { maxTxAmount?: string; maxWalletAmount?: string; buyCooldownSeconds?: number } }) {
  const mcap = Number(token.marketCapUsd);
  const remaining = Number(token.remainingToGraduationUsd);
  const cap = mcap + remaining;
  const progress = cap > 0 ? Math.min((mcap / cap) * 100, 100) : 0;

  const supply = Number(token.totalSupply) / 1e18;
  const pctOfSupply = (raw?: string) =>
    raw && supply > 0 ? `${((Number(raw) / 1e18 / supply) * 100).toFixed(2)}%` : "-";

  return (
    <Card>
      <CardHeader
        title="Trading limits"
        right={
          token.limitsActive ? (
            <Badge tone="amber">Anti-whale active</Badge>
          ) : (
            <Badge tone="up">Unrestricted</Badge>
          )
        }
      />
      <div className="space-y-3 p-4">
        {token.limitsActive ? (
          <>
            <div>
              <div className="mb-1 flex items-baseline justify-between text-xs">
                <span className="text-ink-3">Progress to open trading</span>
                <span className="tnum font-medium text-ink-2">
                  {fmtUsd(mcap)} / {fmtUsd(cap)}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-panel-2">
                <div
                  className="h-full rounded-full bg-amber transition-[width] duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="mt-1.5 text-[11px] leading-4 text-ink-3">
                {fmtUsd(remaining)} of market cap remaining. All limits lift automatically on-chain
                the moment the threshold is crossed. No admin action involved.
              </p>
            </div>
            <dl className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-panel-2 px-2 py-2">
                <dt className="text-[10px] uppercase tracking-wider text-ink-3">Max trade</dt>
                <dd className="tnum mt-0.5 text-sm font-semibold text-ink">
                  {pctOfSupply(token.maxTxAmount)}
                </dd>
                <dd className="tnum text-[10px] text-ink-3">{fmtTokens(token.maxTxAmount)}</dd>
              </div>
              <div className="rounded-lg bg-panel-2 px-2 py-2">
                <dt className="text-[10px] uppercase tracking-wider text-ink-3">Max wallet</dt>
                <dd className="tnum mt-0.5 text-sm font-semibold text-ink">
                  {pctOfSupply(token.maxWalletAmount)}
                </dd>
                <dd className="tnum text-[10px] text-ink-3">{fmtTokens(token.maxWalletAmount)}</dd>
              </div>
              <div className="rounded-lg bg-panel-2 px-2 py-2">
                <dt className="text-[10px] uppercase tracking-wider text-ink-3">Buy cooldown</dt>
                <dd className="tnum mt-0.5 text-sm font-semibold text-ink">
                  {token.buyCooldownSeconds ? `${token.buyCooldownSeconds}s` : "None"}
                </dd>
                <dd className="text-[10px] text-ink-3">per wallet</dd>
              </div>
            </dl>
          </>
        ) : (
          <p className="text-xs leading-5 text-ink-2">
            This token graduated: its market cap crossed the protection threshold and every
            anti-whale limit was removed automatically on-chain. Trading is unrestricted.
          </p>
        )}
        <p className="border-t border-edge pt-3 text-[11px] leading-4 text-ink-3">
          Liquidity is protocol-managed. The Uniswap V3 position is held by the launchpad contract
          and administered by the protocol treasury.
        </p>
      </div>
    </Card>
  );
}
