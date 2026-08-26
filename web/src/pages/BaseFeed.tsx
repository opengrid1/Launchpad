import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTokens } from "@launchpad/sdk/react";
import type { TokenSummary } from "@launchpad/sdk";

import { TokenLogo } from "../components/TokenLogo";
import { client } from "../lib/client";
import { IS_INK } from "../lib/brand";
import { env } from "../lib/env";
import { fmtUsd, shortAddr, timeAgo } from "../lib/format";
import { isHidden, isImpersonator } from "../lib/hiddenTokens";
import { volUsd } from "../components/market/util";
import { PREVIEW, PREVIEW_ON } from "../lib/base/preview";

const REWARDS_READ_ABI = [
  { type: "function", name: "totalRewardsDistributed", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

const fmtCoins = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 4 : 2 });
};

/** Price per coin from market cap (fixed 1B supply on launchpad coins). */
const coinPrice = (t: TokenSummary) => Number(t.marketCapUsd) / 1_000_000_000;

/**
 * squidpad Feed: analytics of rewards paid out to users. Every buy skims 0.5%
 * to holders automatically on chain (totalRewardsDistributed on each coin),
 * so this page reads that counter per coin and rolls it up.
 */
function InkRewardsFeed({ list, preview }: { list: TokenSummary[]; preview: boolean }) {
  const [dist, setDist] = useState<Record<string, number>>({});

  useEffect(() => {
    if (preview || list.length === 0) return;
    let alive = true;
    const load = async () => {
      const entries = await Promise.all(
        list.map(async (t) => {
          try {
            const v = await (client as any).publicClient.readContract({
              address: t.address, abi: REWARDS_READ_ABI, functionName: "totalRewardsDistributed",
            });
            return [t.address, Number(v) / 1e18] as const;
          } catch {
            return [t.address, 0] as const;
          }
        }),
      );
      if (alive) setDist(Object.fromEntries(entries));
    };
    load();
    const id = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, [list, preview]);

  // Preview fixtures have no contracts on chain: derive a plausible figure
  // from volume (0.5% of buys, roughly half the printed volume).
  const coinsOf = (t: TokenSummary) => {
    if (!preview) return dist[t.address] ?? 0;
    const p = coinPrice(t);
    const v = volUsd(t);
    return p > 0 && v > 0 ? (v * 0.0025) / p : 0;
  };

  const rows = useMemo(
    () =>
      list
        .map((t) => {
          const coins = coinsOf(t);
          return { t, coins, usd: coins * coinPrice(t) };
        })
        .sort((a, b) => b.usd - a.usd),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [list, dist, preview],
  );

  const totalUsd = rows.reduce((s, r) => s + r.usd, 0);
  const paying = rows.filter((r) => r.coins > 0).length;

  return (
    <div className="gm-page">
      <div className="gm-feed-head">Rewards paid to holders</div>
      <div className="gm-an">
        <div className="gm-an-tile"><span className="l">Distributed</span><span className="v g">{totalUsd > 0 ? fmtUsd(totalUsd) : "$0"}</span></div>
        <div className="gm-an-tile"><span className="l">Coins paying</span><span className="v">{paying}</span></div>
        <div className="gm-an-tile"><span className="l">Holder share</span><span className="v">0.5%/buy</span></div>
      </div>
      <div className="gm-an-note">
        Every buy pays holders automatically: 0.5% of the coins go to everyone holding, 0.4% to the creator and 0.1% to the platform. No harvesting, no waiting. Claim yours on any coin page or in Rewards.
      </div>
      <div className="gm-list">
        {rows.map(({ t, coins, usd }) => (
          <Link to={`/token/${t.address}`} key={t.address} className="gm-row gm-an-row">
            <TokenLogo token={t} size={42} />
            <span className="gm-mid">
              <span className="gm-l1"><b>{t.symbol}</b><span className="nm">{t.name}</span></span>
              <span className="gm-l2">
                <span>by <b>{shortAddr(t.creator)}</b></span>
                <span>{timeAgo(t.createdAt)}</span>
              </span>
            </span>
            <span className="gm-right">
              <span className="r-amt">{coins > 0 ? `${fmtCoins(coins)} ${t.symbol}` : `0 ${t.symbol}`}</span>
              <span className="c flat">{usd > 0 ? `${fmtUsd(usd)} to holders` : "no buys yet"}</span>
            </span>
          </Link>
        ))}
        {rows.length === 0 && <div className="gm-empty">No coins yet. Rewards show up here with the first buys.</div>}
      </div>
    </div>
  );
}

/** Feed — launch activity for hyperstock, rewards analytics for squidpad. */
export function BaseFeed() {
  const { data: byNew } = useTokens(client, { sort: "new", limit: 50 });

  const list = useMemo(() => {
    if (env.hideTokens) return [] as TokenSummary[];
    const l = (byNew ?? []).filter((t) => !isHidden(t.address) && !isImpersonator(t));
    return l.length === 0 && PREVIEW_ON ? PREVIEW : l;
  }, [byNew]);

  if (IS_INK) return <InkRewardsFeed list={list} preview={list === PREVIEW} />;

  return (
    <div className="kf kf-page">
      <h1 className="kf-page-h1">Feed</h1>
      <div className="kf-feed">
        {list.map((t) => (
          <Link to={`/token/${t.address}`} key={t.address} className="kf-feed-item">
            <div className="kf-feed-head">
              <TokenLogo token={t} size={38} />
              <b>{t.name} <span style={{ color: "var(--color-ink-3)", fontWeight: 600 }}>· {t.symbol}</span></b>
            </div>
            <p className="kf-feed-line">Launched by {shortAddr(t.creator)} · {timeAgo(t.createdAt)}</p>
            <div className="kf-feed-card">
              <span style={{ color: "var(--color-ink-2)", fontSize: 13.5 }}>Market cap</span>
              <span className="v">{Number(t.marketCapUsd) > 0 ? fmtUsd(t.marketCapUsd) : "—"}</span>
              <span style={{ color: "var(--color-ink-2)", fontSize: 13.5 }}>Volume</span>
              <span className="v">{volUsd(t) > 0 ? fmtUsd(volUsd(t)) : "—"}</span>
            </div>
          </Link>
        ))}
        {list.length === 0 && <div className="kf-empty">No launches yet. Be the first.</div>}
      </div>

      {/* Docs entry point: a tappable link at the end of the feed */}
      <Link
        to="/docs"
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          margin: "14px 16px 20px", padding: "13px 15px", borderRadius: 12,
          border: "1px solid var(--color-edge)", background: "var(--color-panel)",
          color: "var(--color-ink)", fontSize: 13.5, fontWeight: 600, textDecoration: "none",
        }}
      >
        <span>How it works · fees, launching, stock pairs</span>
        <span style={{ color: "var(--color-accent-ink)" }}>&rsaquo;</span>
      </Link>
    </div>
  );
}
