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
import { TokenLogo } from "../components/TokenLogo";
import { TradePanel } from "../components/TradePanel";
import { TradesList } from "../components/TradesList";
import { Button, Card, EmptyState, Skeleton } from "../components/ui";
import { client } from "../lib/client";
import { env } from "../lib/env";
import { compact, fmtPct, fmtUsd, fmtWei, fmtWeiUsd, shortAddr, timeAgo, usdRateOf } from "../lib/format";
import { ensureSdkWallet, errorText, useWallet } from "../lib/useWallet";
import { useUi } from "../store";

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
      {/* Identity and market cap, one compact row on every screen */}
      <section className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <TokenLogo token={t} size={44} />
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight text-ink sm:text-xl">
              {t.name} <span className="tnum font-medium text-ink-3">${t.symbol}</span>
            </h1>
            <p className="mt-0.5 truncate text-xs text-ink-3">
              Launched {timeAgo(t.createdAt)} by <span className="tnum">{shortAddr(t.creator)}</span>
            </p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="tnum text-[26px] font-semibold leading-none tracking-tight text-ink sm:text-[32px]">
            {fmtUsd(t.marketCapUsd)}
          </p>
          <p className="mt-1 flex items-center justify-end gap-2 text-xs sm:text-sm">
            <span className="text-ink-3">Market cap</span>
            {t.priceChange24hPct != null ? (
              <span className={`tnum font-medium ${t.priceChange24hPct >= 0 ? "text-up" : "text-down"}`}>
                {fmtPct(t.priceChange24hPct)}
              </span>
            ) : null}
          </p>
        </div>
      </section>

      {/* Key figures, plain typography */}
      <dl className="mt-4 grid grid-cols-2 gap-3 border-y border-edge py-3.5 sm:flex sm:gap-x-10">
        <Figure label="Volume 24h" value={fmtWeiUsd(t.volume24hWei, usdRate)} />
        <Figure label="Liquidity" value={fmtWeiUsd(t.liquidityWei, usdRate)} />
        <Figure label="Holders" value={compact(t.holderCount)} />
        <Figure label="Fees earned" value={fmtWeiUsd(t.creatorFeesWei ?? "0", usdRate)} />
      </dl>

      <CreatorClaim token={t} />

      {/* Chart + trade */}
      <section className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
        <Card className="h-[420px] overflow-hidden lg:h-[480px]">
          <Suspense fallback={<Skeleton className="h-full w-full rounded-2xl" />}>
            <PriceChart token={t.address as Address} />
          </Suspense>
        </Card>
        <TradePanel token={t} />
      </section>

      {/* Detail sections */}
      <section className="mt-8">
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
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-edge bg-panel px-5 py-4">
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
