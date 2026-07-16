import { lazy, Suspense, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useToken } from "@launchpad/sdk/react";
import type { Address, TokenSummary } from "@launchpad/sdk";

// The chart is lazy-loaded so the token header, stats and trade panel paint
// immediately and the price line streams in a beat later.
const PriceChart = lazy(() =>
  import("../components/Chart").then((m) => ({ default: m.PriceChart })),
);
import { AnimatedNumber } from "../components/AnimatedNumber";
import { HoldersList } from "../components/HoldersList";
import { Icon, type IconName } from "../components/Icon";
import { TokenLogo } from "../components/TokenLogo";
import { TradePanel } from "../components/TradePanel";
import { TradesList } from "../components/TradesList";
import { Button, EmptyState, Skeleton } from "../components/ui";
import { client, v4Client } from "../lib/client";
import { env } from "../lib/env";
import { compact, fmtPct, fmtTokens, fmtUsd, fmtWei, fmtWeiUsd, shortAddr, timeAgo, usdRateOf } from "../lib/format";
import { ensureSdkWallet, errorText, useWallet } from "../lib/useWallet";
import { stockOf } from "../lib/v4/stocks";
import { useUi } from "../store";

type Tab = "trades" | "holders" | "info";

/** V4 reward/fee facts for a token, read from the hook + token in one pass. */
interface Extra {
  stock: Address;
  taxBps: number;
  totalRewards: bigint;
  creatorFees: bigint;
}

export function TokenPage() {
  const { address } = useParams<{ address: string }>();
  const token = useToken(client, address as Address | undefined);
  const [tab, setTab] = useState<Tab>("trades");
  const [extra, setExtra] = useState<Extra | null>(null);

  useEffect(() => {
    if (!address) return;
    let live = true;
    const load = () =>
      v4Client
        .tokenExtra(address as Address)
        .then((e) => live && setExtra(e))
        .catch(() => undefined);
    load();
    const id = setInterval(load, 20_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [address]);

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

  const rewardStock = extra ? stockOf(extra.stock) : undefined;

  return (
    <div className="rise mx-auto max-w-6xl px-4 pb-24 sm:px-8">
      {/* Masthead */}
      <div className="flex items-center justify-between border-b border-edge pb-3 pt-8">
        <Link to="/" className="kicker text-[13px] text-ink-2 transition-colors hover:text-ink">← Markets</Link>
        <span className="text-[13px] text-ink-3">{timeAgo(t.createdAt)}</span>
      </div>

      {/* Identity */}
      <section className="flex flex-wrap items-start justify-between gap-6 pt-7">
        <div className="flex min-w-0 items-center gap-4">
          <TokenLogo token={t} size={58} />
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <p className="kicker text-[12px] text-accent-2">Market</p>
              {rewardStock ? <RewardPill stock={extra!.stock} /> : null}
            </div>
            <h1 className="mt-0.5 truncate text-[19px] font-bold leading-tight tracking-tight text-ink sm:text-[23px]">{t.name}</h1>
            <div className="mt-1.5 flex items-center gap-2.5">
              <span className="text-[15px] text-ink-2">{t.symbol}</span>
              <CaChip address={t.address as Address} />
            </div>
          </div>
        </div>
        <SocialRow t={t} meta={meta} />
      </section>

      {/* Figures */}
      <div className="mt-7 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-edge bg-edge sm:grid-cols-3 lg:grid-cols-6">
        <Figure label="Price" node={<span className="tnum">{fmtUsd(t.priceUsd)}</span>} />
        <Figure
          label="Market cap"
          node={<AnimatedNumber value={Number(t.marketCapUsd)} format={(n) => fmtUsd(n)} className="tnum" />}
        />
        <Figure
          label="24-hour"
          node={<span className={`tnum ${change == null ? "" : change >= 0 ? "text-up" : "text-down"}`}>{change == null ? "—" : fmtPct(change)}</span>}
        />
        <Figure label="24h volume" node={<span className="tnum">{fmtWeiUsd(t.volume24hWei, usdRate)}</span>} />
        <Figure label="Liquidity" node={<span className="tnum">{fmtWeiUsd(t.liquidityWei, usdRate)}</span>} />
        <Figure label="Holders" node={<span className="tnum">{compact(t.holderCount)}</span>} />
      </div>

      <div className="mt-4 space-y-2.5">
        <RewardsStrip token={t} extra={extra} />
        <CreatorClaim token={t} extra={extra} onClaimed={() => v4Client.tokenExtra(t.address as Address).then(setExtra).catch(() => undefined)} />
      </div>

      {/* Chart (hero) + order ticket */}
      <section className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1.6fr_360px]">
        <div className="h-[440px] overflow-hidden rounded-2xl border border-edge bg-panel">
          <Suspense fallback={<Skeleton className="h-full w-full" />}>
            <PriceChart token={t.address as Address} />
          </Suspense>
        </div>
        <div>
          <TradePanel token={t} />
        </div>
      </section>

      {/* Detail — trades / holders / information */}
      <section className="mt-12">
        <div className="rule mb-5" />
        <div className="flex items-center gap-7 border-b border-edge">
          {(
            [
              ["trades", "Trades", "transactions"],
              ["holders", "Holders", "holders"],
              ["info", "Information", "contract"],
            ] as [Tab, string, IconName][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`relative -mb-px pb-3 text-[15px] transition-colors ${
                tab === key ? "font-semibold text-ink" : "text-ink-2 hover:text-ink"
              }`}
            >
              {label}
              {tab === key ? <span className="absolute inset-x-0 -bottom-px h-[2px] bg-accent" /> : null}
            </button>
          ))}
        </div>

        <div className="mt-2 overflow-hidden rounded-2xl border border-edge bg-panel">
          {tab === "trades" ? <TradesList token={t.address as Address} symbol={t.symbol} /> : null}
          {tab === "holders" ? <HoldersList token={t} /> : null}
          {tab === "info" ? <InfoTab t={t} meta={meta} extra={extra} /> : null}
        </div>
      </section>
    </div>
  );
}

/** Small copyable contract-address chip for the token identity bar. */
function CaChip({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(address).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        });
      }}
      title={copied ? "Copied" : "Copy contract address"}
      className={`mono flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] transition-colors ${
        copied
          ? "border-up/40 bg-up/10 text-up"
          : "border-edge bg-panel-2/50 text-ink-3 hover:border-edge-2 hover:text-ink-2"
      }`}
    >
      <span>{shortAddr(address)}</span>
      <Icon name={copied ? "verified" : "copy"} size={11} />
    </button>
  );
}

/** Editorial figure cell: quiet grey label above a serif value, on white. */
function Figure({ label, node }: { label: string; node: React.ReactNode }) {
  return (
    <div className="bg-panel px-3 py-2.5">
      <p className="text-[11px] text-ink-2">{label}</p>
      <p className="mono mt-0.5 text-[15px] font-bold tracking-tight text-ink">{node}</p>
    </div>
  );
}

/** A small "Holders earn {STOCK}" pill for the token identity bar. */
function RewardPill({ stock }: { stock: Address }) {
  const s = stockOf(stock);
  if (!s || /^0x0+$/.test(stock)) return null;
  return (
    <span
      title={`Holders earn ${s.name} (${s.symbol})`}
      className="flex shrink-0 items-center gap-1 rounded-full border border-accent/30 bg-accent/[0.07] px-2 py-0.5 text-[11px] font-semibold text-accent-2"
    >
      Earns {s.symbol}
    </span>
  );
}

/**
 * Holder reward console: the stock every holder earns from trades, how much has
 * been paid out lifetime, and the connected wallet's claimable balance. Anyone
 * can trigger a distribution, which realizes accrued tax into stock rewards.
 */
function RewardsStrip({ token, extra }: { token: TokenSummary; extra: Extra | null }) {
  const { address, isConnected } = useWallet();
  const pushToast = useUi((s) => s.pushToast);
  const [pending, setPending] = useState(0n);
  const [busy, setBusy] = useState<"claim" | "harvest" | null>(null);

  const stock = extra ? stockOf(extra.stock) : undefined;

  const refresh = () => {
    if (isConnected && address)
      v4Client
        .pendingDividends(token.address as Address, address)
        .then(setPending)
        .catch(() => undefined);
  };
  useEffect(refresh, [isConnected, address, token.address, extra?.totalRewards]);

  if (!extra || !stock || /^0x0+$/.test(extra.stock)) return null;

  const run = async (kind: "claim" | "harvest") => {
    setBusy(kind);
    try {
      if (!(await ensureSdkWallet())) throw new Error("Wallet session expired. Reconnect and try again.");
      const hash =
        kind === "claim"
          ? await v4Client.claimDividends(token.address as Address)
          : await v4Client.harvest(token.address as Address);
      pushToast({ kind: "info", title: kind === "claim" ? "Claim submitted" : "Distributing rewards", txHash: hash });
      await client.publicClient.waitForTransactionReceipt({ hash });
      pushToast({
        kind: "success",
        title: kind === "claim" ? `${stock.symbol} claimed` : "Rewards distributed",
        body: kind === "claim" ? "Sent to your wallet." : "Holder rewards are now claimable.",
        txHash: hash,
      });
      refresh();
    } catch (err) {
      pushToast({ kind: "error", title: kind === "claim" ? "Claim failed" : "Distribution failed", body: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-edge bg-panel px-4 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink">
          Holders earn {stock.name} <span className="text-ink-3">({stock.symbol})</span>
        </p>
        <p className="mt-0.5 text-xs text-ink-3">
          Every trade pays holders {stock.symbol}, split by how much you hold. {fmtTokens(extra.totalRewards.toString())} {stock.symbol} paid out so far.
        </p>
      </div>
      <div className="flex items-center gap-3">
        {isConnected ? (
          <div className="text-right">
            <p className="tnum text-[15px] font-semibold text-ink">
              {fmtWei(pending)} {stock.symbol}
            </p>
            <p className="text-[11px] text-ink-3">claimable</p>
          </div>
        ) : null}
        {isConnected && pending > 0n ? (
          <Button variant="primary" disabled={busy !== null} onClick={() => run("claim")}>
            {busy === "claim" ? "Claiming" : `Claim ${stock.symbol}`}
          </Button>
        ) : (
          <Button variant="ghost" disabled={busy !== null} onClick={() => run("harvest")}>
            {busy === "harvest" ? "Distributing" : "Distribute"}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Creator's own fee console. Shown only to the wallet that launched the token:
 * it surfaces the claimable creator share (25% of every trade's tax, in WETH)
 * and a one-tap claim. Everyone else never sees it.
 */
function CreatorClaim({
  token,
  extra,
  onClaimed,
}: {
  token: TokenSummary;
  extra: Extra | null;
  onClaimed: () => void;
}) {
  const { address, isConnected } = useWallet();
  const pushToast = useUi((s) => s.pushToast);
  const [busy, setBusy] = useState(false);

  const isCreator = isConnected && address?.toLowerCase() === token.creator.toLowerCase();
  if (!isCreator || !extra) return null;

  const claimable = extra.creatorFees;
  const usdRate = usdRateOf(token);

  const claim = async () => {
    setBusy(true);
    try {
      if (!(await ensureSdkWallet())) throw new Error("Wallet session expired. Reconnect and try again.");
      const hash = await client.claimCreatorFees(token.address as Address);
      pushToast({ kind: "info", title: "Claim submitted", txHash: hash });
      await client.publicClient.waitForTransactionReceipt({ hash });
      pushToast({ kind: "success", title: "Fees claimed", body: "Sent to your wallet.", txHash: hash });
      onClaimed();
    } catch (err) {
      pushToast({ kind: "error", title: "Claim failed", body: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/25 bg-accent/[0.04] px-4 py-2.5">
      <div>
        <p className="text-sm font-semibold text-ink">Your creator fees</p>
        <p className="mt-0.5 text-xs text-ink-3">
          You earn 25% of every trade's tax, paid in WETH. Claim anytime, straight to your wallet.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <div className="text-right">
          <p className="tnum text-[15px] font-semibold text-ink">{fmtWei(claimable)} WETH</p>
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

function InfoTab({ t, meta, extra }: { t: any; meta: any; extra: Extra | null }) {
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

  const taxBps = extra?.taxBps ?? Number(t.feeTier);
  const rewardStock = extra ? stockOf(extra.stock) : undefined;
  const facts: { label: string; value: string }[] = [
    { label: "Total supply", value: fmtTokens(t.totalSupply) },
    { label: "Trade tax", value: isFinite(taxBps) ? `${(taxBps / 100).toFixed(taxBps % 100 ? 1 : 0)}%` : "—" },
    { label: "Holders earn", value: rewardStock ? rewardStock.symbol : "—" },
    { label: "Launched", value: timeAgo(t.createdAt) },
  ];

  return (
    <div className="space-y-4 p-3">
      {meta.description ? (
        <p className="text-[13px] leading-6 text-ink-2">{meta.description}</p>
      ) : (
        <p className="text-[13px] italic leading-6 text-ink-3">No description provided.</p>
      )}

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-edge bg-edge">
        {facts.map((f) => (
          <div key={f.label} className="bg-panel-2/40 px-3 py-2.5">
            <dt className="text-[10px] uppercase tracking-wide text-ink-3">{f.label}</dt>
            <dd className="mono mt-0.5 text-[13px] font-semibold text-ink">{f.value}</dd>
          </div>
        ))}
      </dl>

      {links.length > 0 ? (
        <div className="flex flex-wrap gap-2">
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

      <div className="space-y-2">
        <CopyRow label="Creator" value={t.creator} />
        <CopyRow label="Liquidity pool" value={t.pool} />
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
