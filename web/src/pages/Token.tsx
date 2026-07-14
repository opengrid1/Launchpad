import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useToken } from "@launchpad/sdk/react";
import type { Address } from "@launchpad/sdk";

import { PriceChart } from "../components/Chart";
import { HoldersList } from "../components/HoldersList";
import { TokenLogo } from "../components/TokenLogo";
import { TradePanel } from "../components/TradePanel";
import { TradesList } from "../components/TradesList";
import { Card, EmptyState, Skeleton } from "../components/ui";
import { client } from "../lib/client";
import { env } from "../lib/env";
import { compact, explorerAddr, fmtPct, fmtUsd, fmtWei, shortAddr, timeAgo } from "../lib/format";

type Tab = "trades" | "holders" | "info";

export function TokenPage() {
  const { address } = useParams<{ address: string }>();
  const token = useToken(client, address as Address | undefined);
  const [tab, setTab] = useState<Tab>("trades");

  if (token.loading) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-8 sm:px-6">
        <Skeleton className="h-16" />
        <Skeleton className="h-[420px] rounded-2xl" />
      </div>
    );
  }
  if (token.error || !token.data) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <EmptyState title="Token not found" body="Check the address, or the indexer may still be catching up." />
      </div>
    );
  }
  const t = token.data;
  const meta = t.metadata ?? {};

  const mcap = Number(t.marketCapUsd);
  const remaining = Number(t.remainingToGraduationUsd);
  const cap = mcap + remaining;
  const progress = cap > 0 ? Math.min((mcap / cap) * 100, 100) : 0;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      {/* Identity and price */}
      <section className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="flex items-center gap-3.5">
          <TokenLogo token={t} size={48} />
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-ink">
              {t.name} <span className="font-medium text-ink-3">{t.symbol}</span>
            </h1>
            <p className="mt-0.5 text-xs text-ink-3">
              Launched {timeAgo(t.createdAt)} by <span className="tnum">{shortAddr(t.creator)}</span>
            </p>
          </div>
        </div>
        <div>
          <p className="tnum text-[32px] font-semibold leading-none tracking-tight text-ink">
            {fmtUsd(t.priceUsd)}
          </p>
          <p
            className={`tnum mt-1.5 text-sm font-medium ${
              t.priceChange24hPct == null ? "text-ink-3" : t.priceChange24hPct >= 0 ? "text-up" : "text-down"
            }`}
          >
            {fmtPct(t.priceChange24hPct)} today
          </p>
        </div>
      </section>

      {/* Key figures, plain typography */}
      <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-3 border-y border-edge py-4">
        <Figure label="Market cap" value={fmtUsd(t.marketCapUsd)} />
        <Figure label="Volume 24h" value={`${fmtWei(t.volume24hWei)} ${env.nativeSymbol}`} />
        <Figure label="Liquidity" value={`${fmtWei(t.liquidityWei)} ${env.nativeSymbol}`} />
        <Figure label="Holders" value={compact(t.holderCount)} />
      </dl>

      {t.limitsActive ? (
        <div className="mt-4 flex items-center gap-3 text-xs text-ink-2">
          <div className="h-1 w-28 overflow-hidden rounded-full bg-panel-2">
            <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${progress}%` }} />
          </div>
          <span>
            Protected market: max transaction limits until {fmtUsd(cap)} market cap.{" "}
            <span className="tnum">{fmtUsd(remaining)}</span> to go, lifted automatically on-chain.
          </span>
        </div>
      ) : null}

      {/* Chart + trade */}
      <section className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
        <Card className="h-[420px] overflow-hidden lg:h-[480px]">
          <PriceChart token={t.address as Address} />
        </Card>
        <TradePanel token={t} />
      </section>

      {/* Detail sections */}
      <section className="mt-10">
        <div className="flex items-center gap-6 border-b border-edge">
          {(
            [
              ["trades", "Recent Trades"],
              ["holders", "Holders"],
              ["info", "Info"],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`relative pb-2.5 text-sm font-medium transition-colors ${
                tab === key ? "text-ink" : "text-ink-3 hover:text-ink-2"
              }`}
            >
              {label}
              {tab === key ? (
                <span className="absolute bottom-0 left-0 right-0 h-[3px] rounded-full bg-accent" />
              ) : null}
            </button>
          ))}
        </div>

        <div className="mt-2">
          {tab === "trades" ? <TradesList token={t.address as Address} symbol={t.symbol} /> : null}
          {tab === "holders" ? <HoldersList token={t} /> : null}
          {tab === "info" ? <InfoTab t={t} meta={meta} /> : null}
        </div>
      </section>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dd className="tnum text-[15px] font-semibold text-ink">{value}</dd>
      <dt className="mt-0.5 text-xs text-ink-3">{label}</dt>
    </div>
  );
}

function InfoTab({ t, meta }: { t: any; meta: any }) {
  const [pool, setPool] = useState<Awaited<ReturnType<typeof client.getPoolInfo>> | null>(null);
  useEffect(() => {
    let cancelled = false;
    client
      .getPoolInfo(t.address)
      .then((p) => !cancelled && setPool(p))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [t.address]);

  const links: { label: string; url?: string }[] = [
    { label: "Website", url: meta.website },
    { label: "X", url: meta.twitter },
    { label: "Telegram", url: meta.telegram },
    ...(meta.links ?? []),
  ].filter((l) => l.url);

  return (
    <div className="max-w-2xl py-5">
      {meta.description ? (
        <p className="text-sm leading-6 text-ink-2">{meta.description}</p>
      ) : null}

      {links.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {links.map((l) => (
            <a
              key={l.label + l.url}
              href={String(l.url)}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-edge bg-panel px-3.5 py-1.5 text-xs font-medium text-ink transition-colors hover:border-edge-2"
            >
              {l.label}
            </a>
          ))}
        </div>
      ) : null}

      <dl className="mt-6 grid grid-cols-[140px_1fr] gap-y-2 text-sm">
        <dt className="text-ink-3">Contract</dt>
        <dd className="tnum text-ink">
          {explorerAddr(t.address) ? (
            <a className="underline underline-offset-2" href={explorerAddr(t.address)!} target="_blank" rel="noreferrer">
              {shortAddr(t.address)}
            </a>
          ) : (
            shortAddr(t.address)
          )}
        </dd>
        <dt className="text-ink-3">Pool</dt>
        <dd className="tnum text-ink">{shortAddr(t.pool)}</dd>
        <dt className="text-ink-3">Trading fee</dt>
        <dd className="text-ink">1%, paid to the creator</dd>
        <dt className="text-ink-3">Liquidity</dt>
        <dd className="text-ink">Protocol-managed Uniswap V3 position{pool ? ` (NFT #${pool.positionTokenId})` : ""}</dd>
        <dt className="text-ink-3">Protection</dt>
        <dd className="text-ink">
          {t.limitsActive
            ? "Max transaction active until the 40,000 USD market cap, removed automatically"
            : "Graduated, trading is unrestricted"}
        </dd>
      </dl>
    </div>
  );
}
