import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useToken } from "@launchpad/sdk/react";
import type { Address } from "@launchpad/sdk";

import { PriceChart } from "../components/Chart";
import { HoldersList } from "../components/HoldersList";
import { LimitsCard } from "../components/LimitsCard";
import { TokenLogo } from "../components/TokenTable";
import { TradePanel } from "../components/TradePanel";
import { TradesList } from "../components/TradesList";
import { Badge, Card, CardHeader, EmptyState, Skeleton } from "../components/ui";
import { client } from "../lib/client";
import { env } from "../lib/env";
import {
  compact,
  explorerAddr,
  fmtPct,
  fmtUsd,
  fmtWei,
  shortAddr,
  timeAgo,
} from "../lib/format";

type Tab = "trades" | "holders" | "pool" | "about";

export function TokenPage() {
  const { address } = useParams<{ address: string }>();
  const token = useToken(client, address as Address | undefined);
  const [tab, setTab] = useState<Tab>("trades");

  if (token.loading) {
    return (
      <div className="mx-auto max-w-7xl space-y-4 px-4 py-6">
        <Skeleton className="h-16" />
        <Skeleton className="h-[420px]" />
      </div>
    );
  }
  if (token.error || !token.data) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6">
        <EmptyState title="Token not found" body="Check the address, or the indexer may still be catching up." />
      </div>
    );
  }
  const t = token.data;
  const meta = t.metadata ?? {};

  const socials: { label: string; url?: string }[] = [
    { label: "Website", url: meta.website },
    { label: "X", url: meta.twitter },
    { label: "Telegram", url: meta.telegram },
    ...(meta.links ?? []).map((l) => ({ label: l.label, url: l.url })),
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      {/* Header row */}
      <section className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-3">
          <TokenLogo token={t} size={40} />
          <div>
            <h1 className="flex items-center gap-2 text-lg font-semibold text-ink">
              {t.name}
              <span className="text-ink-3">{t.symbol}</span>
              {t.featured ? <Badge tone="accent">Featured</Badge> : null}
              {t.limitsActive ? <Badge tone="amber">Protected</Badge> : <Badge tone="up">Open</Badge>}
            </h1>
            <p className="text-xs text-ink-3">
              Created {timeAgo(t.createdAt)} by{" "}
              {explorerAddr(t.creator) ? (
                <a
                  className="text-accent-2 hover:underline"
                  href={explorerAddr(t.creator)!}
                  target="_blank"
                  rel="noreferrer"
                >
                  {shortAddr(t.creator)}
                </a>
              ) : (
                <span className="tnum">{shortAddr(t.creator)}</span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-baseline gap-3">
          <span className="tnum text-2xl font-semibold text-ink">{fmtUsd(t.priceUsd)}</span>
          <span
            className={`tnum text-sm font-medium ${
              t.priceChange24hPct == null
                ? "text-ink-3"
                : t.priceChange24hPct >= 0
                  ? "text-up"
                  : "text-down"
            }`}
          >
            {fmtPct(t.priceChange24hPct)} 24h
          </span>
        </div>

        <dl className="ml-auto flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
          <HeaderStat label="Market cap" value={fmtUsd(t.marketCapUsd)} />
          <HeaderStat label="Liquidity" value={`${fmtWei(t.liquidityWei)} ${env.nativeSymbol}`} />
          <HeaderStat label="24h volume" value={`${fmtWei(t.volume24hWei)} ${env.nativeSymbol}`} />
          <HeaderStat label="Holders" value={compact(t.holderCount)} />
          <HeaderStat label="Fee tier" value={`${(t.feeTier / 10000).toFixed(2)}%`} />
        </dl>
      </section>

      {/* Chart + trade panel */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
        <Card className="h-[440px] overflow-hidden lg:h-[520px]">
          <PriceChart token={t.address as Address} />
        </Card>
        <div className="flex flex-col gap-4">
          <Card>
            <TradePanel token={t} />
          </Card>
          <LimitsCard token={t as any} />
        </div>
      </section>

      {/* Tabs */}
      <section className="mt-4">
        <Card>
          <div className="flex items-center gap-1 border-b border-edge px-3 py-2">
            {(
              [
                ["trades", "Trades"],
                ["holders", "Holders"],
                ["pool", "Pool"],
                ["about", "About"],
              ] as [Tab, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  tab === key ? "bg-panel-2 text-ink" : "text-ink-3 hover:text-ink-2"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === "trades" ? <TradesList token={t.address as Address} symbol={t.symbol} /> : null}
          {tab === "holders" ? <HoldersList token={t} /> : null}
          {tab === "pool" ? <PoolTab token={t.address as Address} pool={t.pool} feeTier={t.feeTier} /> : null}
          {tab === "about" ? (
            <div className="space-y-4 p-4">
              <p className="max-w-2xl text-sm leading-6 text-ink-2">
                {meta.description || "No description provided."}
              </p>
              <div className="flex flex-wrap gap-2">
                {socials
                  .filter((s) => s.url)
                  .map((s) => (
                    <a
                      key={s.label + s.url}
                      href={String(s.url)}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg border border-edge-2 px-3 py-1.5 text-xs font-medium text-ink-2 transition-colors hover:border-accent hover:text-accent-2"
                    >
                      {s.label}
                    </a>
                  ))}
              </div>
              <dl className="grid max-w-md grid-cols-2 gap-y-1 text-xs">
                <dt className="text-ink-3">Contract</dt>
                <dd className="tnum text-ink-2">{shortAddr(t.address)}</dd>
                <dt className="text-ink-3">Pool</dt>
                <dd className="tnum text-ink-2">{shortAddr(t.pool)}</dd>
                <dt className="text-ink-3">Total supply</dt>
                <dd className="tnum text-ink-2">{compact(Number(t.totalSupply) / 1e18)}</dd>
              </dl>
            </div>
          ) : null}
        </Card>
      </section>
    </div>
  );
}

function HeaderStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-ink-3">{label}</dt>
      <dd className="tnum mt-0.5 font-semibold text-ink-2">{value}</dd>
    </div>
  );
}

function PoolTab({ token, pool, feeTier }: { token: Address; pool: string; feeTier: number }) {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof client.getPoolInfo>> | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    client
      .getPoolInfo(token)
      .then((i) => !cancelled && setInfo(i))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="p-4">
      {failed ? (
        <EmptyState title="Pool data unavailable" />
      ) : !info ? (
        <Skeleton className="h-24" />
      ) : (
        <dl className="grid max-w-xl grid-cols-2 gap-y-2 text-sm">
          <dt className="text-ink-3">Pool address</dt>
          <dd className="tnum text-ink-2">
            {explorerAddr(pool) ? (
              <a href={explorerAddr(pool)!} target="_blank" rel="noreferrer" className="hover:text-accent-2">
                {shortAddr(pool)}
              </a>
            ) : (
              shortAddr(pool)
            )}
          </dd>
          <dt className="text-ink-3">Fee tier</dt>
          <dd className="tnum text-ink-2">{(feeTier / 10000).toFixed(2)}%</dd>
          <dt className="text-ink-3">In-range liquidity</dt>
          <dd className="tnum text-ink-2">{compact(Number(info.poolLiquidity))}</dd>
          <dt className="text-ink-3">Current tick</dt>
          <dd className="tnum text-ink-2">{info.tick}</dd>
          <dt className="text-ink-3">Protocol position</dt>
          <dd className="tnum text-ink-2">NFT #{info.positionTokenId}</dd>
          <dt className="text-ink-3">Position liquidity</dt>
          <dd className="tnum text-ink-2">{compact(Number(info.positionLiquidity))}</dd>
        </dl>
      )}
      <p className="mt-4 border-t border-edge pt-3 text-[11px] text-ink-3">
        Liquidity is protocol-managed. The full-range Uniswap V3 position created at launch is held
        and administered by the launchpad contract under role-based access control.
      </p>
    </div>
  );
}
