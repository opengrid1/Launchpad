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
import { compact, fmtPct, fmtUsd, fmtWeiUsd, shortAddr, timeAgo, usdRateOf } from "../lib/format";

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

  const usdRate = usdRateOf(t);

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
        <Figure label="Volume 24h" value={fmtWeiUsd(t.volume24hWei, usdRate)} />
        <Figure label="Liquidity" value={fmtWeiUsd(t.liquidityWei, usdRate)} />
        <Figure label="Holders" value={compact(t.holderCount)} />
      </dl>

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

const socialIcons: Record<string, JSX.Element> = {
  Website: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.4" />
      <path d="M1.75 8h12.5M8 1.75c1.8 1.7 2.7 3.9 2.7 6.25S9.8 12.55 8 14.25c-1.8-1.7-2.7-3.9-2.7-6.25S6.2 3.45 8 1.75z" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  ),
  X: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M9.5 6.8L15 .5h-1.5L8.9 5.9 5.2.5H0l5.9 8.6L0 15.5h1.5l5.1-5.9 4 5.9H16L9.5 6.8zm-1.8 2.1l-.6-.85L2 1.6h2.2l3.8 5.45.6.85 5 7.1h-2.2L7.7 8.9z" />
    </svg>
  ),
  Telegram: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M14.7 1.6L1.3 6.8c-.9.35-.9 1.2 0 1.5l3.4 1.05 1.3 4.1c.25.7.9.85 1.45.35l1.9-1.8 3.5 2.6c.6.35 1.25.1 1.4-.65l2.3-11.1c.2-.95-.55-1.6-1.85-1.25zM5.6 9.1l7.2-4.55c.35-.2.65.05.4.3L7.3 10.4l-.25 2.5-1.45-3.8z" />
    </svg>
  ),
};

function InfoTab({ t, meta }: { t: any; meta: any }) {
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
              aria-label={l.label}
              title={l.label}
              className="grid h-9 w-9 place-items-center rounded-full border border-edge bg-panel text-ink-2 transition-colors hover:border-edge-2 hover:text-ink"
            >
              {socialIcons[l.label] ?? socialIcons.Website}
            </a>
          ))}
        </div>
      ) : null}

      <div className="mt-6 space-y-3">
        <CopyRow label="Contract" value={t.address} />
        <CopyRow label="Creator" value={t.creator} />
      </div>
    </div>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-edge bg-panel px-3.5 py-2.5">
      <div className="min-w-0">
        <p className="text-[11px] text-ink-3">{label}</p>
        <p className="tnum truncate text-sm text-ink">{value}</p>
      </div>
      <button
        onClick={() => {
          navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        aria-label={`Copy ${label}`}
        title={copied ? "Copied" : "Copy"}
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border transition-colors ${
          copied ? "border-up/40 bg-up/10 text-up" : "border-edge text-ink-2 hover:border-edge-2 hover:text-ink"
        }`}
      >
        {copied ? (
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M3 8.5l3.2 3.2L13 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
            <rect x="5.5" y="5.5" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.5 3.5v-.25A1.75 1.75 0 008.75 1.5h-5A1.75 1.75 0 002 3.25v5c0 .97.78 1.75 1.75 1.75h.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        )}
      </button>
    </div>
  );
}
