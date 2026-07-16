import { lazy, Suspense, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useToken } from "@launchpad/sdk/react";
import type { Address, TokenSummary } from "@launchpad/sdk";

// The candlestick engine (lightweight-charts) is the heaviest dependency on
// the page. Split it into its own chunk so the token header, stats and trade
// panel paint immediately and the chart streams in a beat later.
const PriceChart = lazy(() =>
  import("../components/Chart").then((m) => ({ default: m.PriceChart })),
);
import { HoldersList } from "../components/HoldersList";
import { Icon, type IconName } from "../components/Icon";
import { TokenLogo } from "../components/TokenLogo";
import { TradePanel } from "../components/TradePanel";
import { TradesList } from "../components/TradesList";
import { Button, Card, EmptyState, Skeleton } from "../components/ui";
import { client } from "../lib/client";
import { env } from "../lib/env";
import { compact, fmtPct, fmtTokens, fmtUsd, fmtWei, fmtWeiUsd, shortAddr, timeAgo, usdRateOf } from "../lib/format";
import { ensureSdkWallet, errorText, useWallet } from "../lib/useWallet";
import { useUi } from "../store";

type Tab = "trades" | "holders" | "info";

export function TokenPage() {
  const { address } = useParams<{ address: string }>();
  const token = useToken(client, address as Address | undefined);
  const [tab, setTab] = useState<Tab>("trades");

  if (token.loading) {
    return (
      <div className="mx-auto max-w-[1400px] space-y-3 px-3 py-4 sm:px-4">
        <Skeleton className="h-14" />
        <Skeleton className="h-[460px] rounded-xl" />
      </div>
    );
  }
  if (token.error || !token.data) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-8">
        <EmptyState title="Token not found" body="Check the address, or the indexer may still be catching up." />
      </div>
    );
  }
  const t = token.data;
  const meta = t.metadata ?? {};

  const usdRate = usdRateOf(t);
  const change = t.priceChange24hPct;

  return (
    <div className="rise mx-auto max-w-[1400px] px-3 py-4 sm:px-4">
      {/* Identity + live price bar */}
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-edge bg-panel px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <TokenLogo token={t} size={42} />
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-[17px] font-bold tracking-tight text-ink">
              <span className="truncate">{t.name}</span>
              <span className="mono shrink-0 rounded bg-panel-2 px-1.5 py-0.5 text-[11px] font-semibold text-ink-2">${t.symbol}</span>
            </h1>
            <p className="mono mt-0.5 truncate text-[11px] text-ink-3">
              {shortAddr(t.creator)} · {timeAgo(t.createdAt)}
            </p>
          </div>
        </div>

        {/* Inline market readout */}
        <div className="flex items-center gap-5">
          <Readout label="Market Cap" value={fmtUsd(t.marketCapUsd)} big />
          <Readout
            label="24h"
            value={change == null ? "—" : fmtPct(change)}
            tone={change == null ? undefined : change >= 0 ? "up" : "down"}
          />
          <div className="hidden sm:block"><Readout label="Vol 24h" value={fmtWeiUsd(t.volume24hWei, usdRate)} /></div>
          <div className="hidden md:block"><Readout label="Liquidity" value={fmtWeiUsd(t.liquidityWei, usdRate)} /></div>
          <div className="hidden lg:block"><Readout label="Holders" value={compact(t.holderCount)} /></div>
          <SocialRow t={t} meta={meta} />
        </div>
      </section>

      <CreatorClaim token={t} />

      {/* Chart (dominant) + order panel */}
      <section className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_300px]">
        <div className="h-[440px] overflow-hidden rounded-xl border border-edge bg-panel lg:h-[560px]">
          <Suspense fallback={<Skeleton className="h-full w-full" />}>
            <PriceChart token={t.address as Address} />
          </Suspense>
        </div>
        <TradePanel token={t} />
      </section>

      {/* Detail sections */}
      <section className="mt-3 rounded-xl border border-edge bg-panel">
        <div className="flex items-center gap-1 border-b border-edge px-2">
          {(
            [
              ["trades", "Trades", "transactions"],
              ["holders", "Holders", "holders"],
              ["info", "Info", "contract"],
            ] as [Tab, string, IconName][]
          ).map(([key, label, icon]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`relative flex items-center gap-1.5 px-3 py-2.5 text-[13px] font-semibold transition-colors ${
                tab === key ? "text-ink" : "text-ink-3 hover:text-ink-2"
              }`}
            >
              <Icon name={icon} size={14} />
              {label}
              {tab === key ? (
                <span className="absolute inset-x-3 -bottom-px h-[2px] rounded-full bg-accent" />
              ) : null}
            </button>
          ))}
        </div>

        <div className="px-2">
          {tab === "trades" ? <TradesList token={t.address as Address} symbol={t.symbol} /> : null}
          {tab === "holders" ? <HoldersList token={t} /> : null}
          {tab === "info" ? <InfoTab t={t} meta={meta} /> : null}
        </div>
      </section>
    </div>
  );
}

function Readout({
  label,
  value,
  tone,
  big,
}: {
  label: string;
  value: string;
  tone?: "up" | "down";
  big?: boolean;
}) {
  return (
    <div className="text-right">
      <p className="text-[10px] uppercase tracking-wide text-ink-3">{label}</p>
      <p
        className={`mono font-bold leading-tight ${big ? "text-[18px]" : "text-[14px]"} ${
          tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-ink"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

/**
 * Creator's own fee console. Shown only to the wallet that launched the token:
 * it surfaces the claimable 80% share and a one-tap claim. Everyone else never
 * sees it, so the control is public to the creator without cluttering the page.
 */
function CreatorClaim({ token }: { token: TokenSummary }) {
  const { address, isConnected } = useWallet();
  const pushToast = useUi((s) => s.pushToast);
  const [busy, setBusy] = useState(false);

  const isCreator = isConnected && address?.toLowerCase() === token.creator.toLowerCase();
  if (!isCreator) return null;

  const claimable = BigInt(token.creatorFeesWei ?? "0");
  const usdRate = usdRateOf(token);

  const claim = async () => {
    setBusy(true);
    try {
      if (!(await ensureSdkWallet())) throw new Error("Wallet session expired. Reconnect and try again.");
      const hash = await client.claimCreatorFees(token.address as Address);
      pushToast({ kind: "info", title: "Claim submitted", txHash: hash });
      await client.publicClient.waitForTransactionReceipt({ hash });
      pushToast({ kind: "success", title: "Fees claimed", body: "Sent to your wallet.", txHash: hash });
    } catch (err) {
      pushToast({ kind: "error", title: "Claim failed", body: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/25 bg-accent/[0.04] px-4 py-3">
      <div>
        <p className="text-sm font-semibold text-ink">Your creator fees</p>
        <p className="mt-0.5 text-xs text-ink-3">
          You earn 80% of this token's 1% trading fee. Claim anytime, straight to your wallet.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <div className="text-right">
          <p className="tnum text-[15px] font-semibold text-ink">
            {fmtWei(claimable)} {env.nativeSymbol}
          </p>
          <p className="tnum text-[11px] text-ink-3">{fmtWeiUsd(claimable.toString(), usdRate)}</p>
        </div>
        <Button variant="dark" disabled={busy || claimable === 0n} onClick={claim}>
          {busy ? "Claiming" : "Claim fees"}
        </Button>
      </div>
    </div>
  );
}

function SocialRow({ t, meta }: { t: TokenSummary; meta: TokenSummary["metadata"] }) {
  const explorer = env.explorerUrl?.replace(/\/$/, "");
  const links = [
    meta.website ? { icon: "website" as IconName, url: String(meta.website), label: "Website" } : null,
    meta.twitter ? { icon: "twitter" as IconName, url: String(meta.twitter), label: "X" } : null,
    meta.telegram ? { icon: "telegram" as IconName, url: String(meta.telegram), label: "Telegram" } : null,
    { icon: "trending" as IconName, url: `https://dexscreener.com/robinhood/${t.pool}`, label: "DexScreener" },
    explorer ? { icon: "external" as IconName, url: `${explorer}/token/${t.address}`, label: "Explorer" } : null,
  ].filter((l): l is { icon: IconName; url: string; label: string } => Boolean(l));
  if (links.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {links.map((l) => (
        <a
          key={l.label}
          href={l.url}
          target="_blank"
          rel="noreferrer"
          aria-label={l.label}
          title={l.label}
          className="grid h-7 w-7 place-items-center rounded-md border border-edge text-ink-2 transition-colors hover:border-edge-2 hover:text-ink"
        >
          <Icon name={l.icon} size={14} />
        </a>
      ))}
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
  DexScreener: (
    <img
      src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAOdEVYdFNvZnR3YXJlAEZpZ21hnrGWYwAABb1JREFUeAHVWk1sE0cUfmvX+aERaU8hVErcSyFUdXojjhQEJ1KpUXsopFJzhVQKh1aCVMqlUEiqhkOLcKQGKarAqQRSDgVXKjdKIjWIHhonajnWyS0n4qoHO0CG/cZ+zniz3n22N1L4pNWuZ2fevPfm/c2sLXKgpaXluFL00daW+tj+GaU9AMuiJfu2tLUVuZTLbWTK3vHDGzby+Wdf249f0N7GD42NkUsbNvBDCwDmNzefPbA1/z69AsCKNDRETkCI19BQ1HzdzB871kd9fYUrFovZimnV7RsbWVpeXqaVlWWanf2Z0ullqgdQdJHnL62mpqaoZYX/pToAxsfGxvRdAggzPv4tpVIpqgdKWSfCDQ2N31ON2rctj27e/IkuX/6GOjs7xePa2tro1KlP7DEdtjArlM1mqRaEw1bW2rev5S+lVNUCgOH793/TTNSD1dU16u//wL6vUg3IhPyYB6Nsy2ZbEMwXaHUUaZWvIFa3uzvmNzxKzc2vK7/Ldjp1+PAR/Yx7JrOqggZomnPcu5dSEt7CkUjDRT8x8/k8TU9Pa1u9enWSDh16h4IGVhmRa21tje7cuU0zMzPa2f1gQQoSAMssjTL1Yn5+QfuFBGIBWltb6dGjxUDs3gvVOnWIhID5FAiv0W6hlogkFuDcuRFNeLeEMJnHXGJIPP3kyX4dKa5cGS9FiXQ6rYKCGeUwB4A5JbyJBLhwYbQ0GQuB6/r1hKoXt24lVXv7W2XMA5hTwpvIhDo6th0XhRpjdPQru6aZoFqB8cPDn1OxMi6jjZAqgUiAaHQ7SyJOAwipyJ4QoKvr3ar8gu09kZjSNAYGBoq0qy8nRALs39+6ow0a4twAx+vpiWuGGCihU6lf9WUCfeLxXh3rMRY0YrH3dtA3V90TEjt7+HDecLh0mWM7/cIWRJcBbNfs9IlEouSYeGf6DzuwOQ+eA3Nik7AZIUynM2sZvs6fH1VnzgyXtR09Gi+rpczIZgJ9JLyJMvGTJ3+XVYuoUWDDMBO0Dw19ptsXFha0aQCTk9+V4nkyOaudFRgY+FCbHxIj6KA/Ks/FxT/Ksjz8pKvrCPlCIqUboKFKsRpad8K5EmaOqVTdBmJCsGkvYHKYGOwefTHGLcmx78BU0B9XJpPxpO00yZoEOH16UEnhZstuDD19uqEkqLRqVSUy2Kwf4AtISoBXtcrJaWpqiiRwC6874Ceh3+4LpsCaRXhMJpMV+6JsMHddzujmhJ2h6zMhM9ZXYp77HjhwULTVRB8zR3gJDPgVdZ4CMPGzZ4crToA+rFXEeC/7xjv04dXyWgEuIEG/JgHAFCaEBvxWAlrlCOTVd3Dw05KgfqvF86LUbm8/WL0A0DprVlI2w169+psZVxKFQIP7s3LcLmEm/ke0F0b2jMfjOLvUY/g8qdDeq8tmKS1katvMfPv5htGhoSHxRh79RkZG9OQTE9v7BDyDeZQWUlo4RBCdgkjDKO5ezmyaEmwWUQmmwkWZNEoheXE/SUXqKQDXNGalKbFftnfcOYq41UduwrPdsxB+W0vPKMR1jl/cdtY+zAi0zoI7te+mCDNkYhx+m8GhKgHAOEym2Se5YRK30GkmILf3qLGc0cotaYEHr1zgKgA0Z2rdTTjANC1UoyZM+3WuGjPEfsK0/Oy9ah+odLFGTc2YzLAZsTObcO7ceFfnttqSS3w26gQ249hlmceAvElnoEJFpXrjxo+lNozBDs0MlzhzFe2+XFCzANgG8nmOCXMrydtLjuc4keCyW0JLAgiAD3xRChBuR/HiPW51WLIzsXWXAkbBtLYPuvggK2jge7H9mbXluGWpBxQw+OAL9VBPT6/oa0u1UCrydvj5881MJNL4pv27hwLE+vq6/jT1+PGfNDc3R8HDupbL/Xf7lf+rga5G8YAGSEV7HtY1Zl7/cr7GXw9CofBF+1W3quED+C4hEwpZd1+8oF9yuf9/N1+8BLa9RuWM0AN4AAAAAElFTkSuQmCC"
      alt=""
      width={18}
      height={18}
      className="rounded"
    />
  ),
};

function InfoTab({ t, meta }: { t: any; meta: any }) {
  const isSelfLink = (url?: string) => {
    if (!url) return false;
    try {
      return new URL(String(url), window.location.origin).host === window.location.host;
    } catch {
      return false;
    }
  };
  const links: { label: string; url?: string }[] = [
    { label: "Website", url: meta.website },
    { label: "X", url: meta.twitter },
    { label: "Telegram", url: meta.telegram },
    ...(meta.links ?? []),
    // Every token gets a DexScreener link automatically via its pool.
    { label: "DexScreener", url: `https://dexscreener.com/robinhood/${t.pool}` },
  ].filter((l) => l.url && !isSelfLink(l.url));

  const feePct = Number(t.feeTier) / 10000;
  const facts: { label: string; value: string }[] = [
    { label: "Total supply", value: fmtTokens(t.totalSupply) },
    { label: "Fee tier", value: isFinite(feePct) ? `${feePct.toFixed(2)}%` : "—" },
    { label: "Trading fee", value: "1.00%" },
    { label: "Launched", value: timeAgo(t.createdAt) },
  ];

  return (
    <div className="py-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        {/* About + facts */}
        <div className="min-w-0">
          {meta.description ? (
            <p className="text-[13px] leading-6 text-ink-2">{meta.description}</p>
          ) : (
            <p className="text-[13px] italic leading-6 text-ink-3">No description provided.</p>
          )}

          <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-edge bg-edge sm:grid-cols-4">
            {facts.map((f) => (
              <div key={f.label} className="bg-panel-2/40 px-3 py-2.5">
                <dt className="text-[10px] uppercase tracking-wide text-ink-3">{f.label}</dt>
                <dd className="mono mt-0.5 text-[13px] font-semibold text-ink">{f.value}</dd>
              </div>
            ))}
          </dl>

          {links.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {links.map((l) => (
                <a
                  key={l.label + l.url}
                  href={String(l.url)}
                  target="_blank"
                  rel="noreferrer"
                  title={l.label}
                  className="flex items-center gap-2 rounded-md border border-edge bg-panel px-2.5 py-1.5 text-[12px] font-medium text-ink-2 transition-colors hover:border-edge-2 hover:text-ink"
                >
                  <span className="grid h-4 w-4 place-items-center text-ink-2">
                    {socialIcons[l.label] ?? socialIcons.Website}
                  </span>
                  {l.label}
                </a>
              ))}
            </div>
          ) : null}
        </div>

        {/* Addresses */}
        <div className="space-y-2">
          <CopyRow label="Creator" value={t.creator} />
          <CopyRow label="Liquidity pool" value={t.pool} />
        </div>
      </div>
    </div>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-edge bg-panel-2/40 px-3.5 py-2.5">
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wide text-ink-3">{label}</p>
        <p className="mono truncate text-[13px] text-ink">{value}</p>
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
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-md border transition-colors ${
          copied ? "border-up/40 bg-up/10 text-up" : "border-edge text-ink-2 hover:border-edge-2 hover:text-ink"
        }`}
      >
        <Icon name={copied ? "verified" : "copy"} size={15} />
      </button>
    </div>
  );
}
