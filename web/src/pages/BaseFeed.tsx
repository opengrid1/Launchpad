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
import { INK_PREVIEW, PREVIEW, PREVIEW_ON } from "../lib/base/preview";

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

  // Preview fixtures have no contracts on chain: they carry a fixed
  // previewRewardsUsd figure instead.
  const coinsOf = (t: TokenSummary) => {
    if (!preview) return dist[t.address] ?? 0;
    const p = coinPrice(t);
    const usd = Number((t as any).previewRewardsUsd ?? 0);
    return p > 0 && usd > 0 ? usd / p : 0;
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
  // Creator and platform accruals scale off the holder counter (0.4 and 0.1
  // per 0.5 skimmed to holders).
  const creatorUsd = totalUsd * 0.8;
  const paying = rows.filter((r) => r.coins > 0).length;
  const top = rows.find((r) => r.usd > 0);
  const maxUsd = Math.max(top?.usd ?? 0, 1e-9);

  return (
    <div className="gm-page">
      <div className="gm-feed-head">Rewards analytics</div>

      <div className="gm-an">
        <div className="gm-an-tile"><span className="l">Paid to holders</span><span className="v g">{totalUsd > 0 ? fmtUsd(totalUsd) : "$0"}</span></div>
        <div className="gm-an-tile"><span className="l">Paid to creators</span><span className="v">{creatorUsd > 0 ? fmtUsd(creatorUsd) : "$0"}</span></div>
        <div className="gm-an-tile"><span className="l">Coins paying</span><span className="v">{paying}<i>/{rows.length}</i></span></div>
        <div className="gm-an-tile"><span className="l">Top payer</span><span className="v">{top ? top.t.symbol : "—"}</span></div>
      </div>

      <div className="gm-an-split">
        <div className="bar">
          <span className="h" style={{ width: "50%" }} />
          <span className="c" style={{ width: "40%" }} />
          <span className="p" style={{ width: "10%" }} />
        </div>
        <div className="legend">
          <span><i className="h" />Holders 0.5%</span>
          <span><i className="c" />Creator 0.4%</span>
          <span><i className="p" />Platform 0.1%</span>
          <b>of every buy, recorded on the trade itself</b>
        </div>
      </div>

      <div className="gm-feed-head">Distribution by coin</div>
      <div className="gm-anb">
        {rows.map(({ t, coins, usd }, i) => {
          const share = totalUsd > 0 ? (usd / totalUsd) * 100 : 0;
          return (
            <Link to={`/token/${t.address}`} key={t.address} className="gm-anb-row">
              <span className="rk">{i + 1}</span>
              <TokenLogo token={t} size={34} />
              <span className="mid">
                <span className="l1"><b>{t.symbol}</b><span className="nm">{t.name}</span></span>
                <span className="track"><span className="fill" style={{ width: `${Math.max((usd / maxUsd) * 100, usd > 0 ? 2 : 0)}%` }} /></span>
              </span>
              <span className="amt">
                <b>{coins > 0 ? `${fmtCoins(coins)} ${t.symbol}` : "0"}</b>
                <span>{usd > 0 ? `${fmtUsd(usd)} · ${share >= 10 ? share.toFixed(0) : share.toFixed(1)}%` : "no buys yet"}</span>
              </span>
            </Link>
          );
        })}
        {rows.length === 0 && <div className="gm-empty">No coins yet. Analytics light up with the first buys.</div>}
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
    if (l.length === 0 && PREVIEW_ON) return IS_INK ? INK_PREVIEW : PREVIEW;
    return l;
  }, [byNew]);

  if (IS_INK) return <InkRewardsFeed list={list} preview={list === INK_PREVIEW} />;

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
