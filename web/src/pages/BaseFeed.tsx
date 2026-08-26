import { useMemo } from "react";
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

/** Feed — the launch activity stream: every new coin as an activity card. */
export function BaseFeed() {
  const { data: byNew } = useTokens(client, { sort: "new", limit: 50 });

  const list = useMemo(() => {
    if (env.hideTokens) return [] as TokenSummary[];
    const l = (byNew ?? []).filter((t) => !isHidden(t.address) && !isImpersonator(t));
    return l.length === 0 && PREVIEW_ON ? PREVIEW : l;
  }, [byNew]);

  if (IS_INK) {
    return (
      <div className="gm-page">
        <div className="gm-feed-head">Launch feed</div>
        <div className="gm-list">
          {list.map((t) => (
            <Link to={`/token/${t.address}`} key={t.address} className="gm-row">
              <TokenLogo token={t} size={42} />
              <span className="gm-mid">
                <span className="gm-l1"><b>{t.symbol}</b><span className="nm">{t.name}</span></span>
                <span className="gm-l2">
                  <span>by <b>{shortAddr(t.creator)}</b></span>
                  <span>{timeAgo(t.createdAt)}</span>
                </span>
              </span>
              <span className="gm-right">
                <span className="p">{Number(t.marketCapUsd) > 0 ? fmtUsd(t.marketCapUsd) : "—"}</span>
                <span className="c flat">{volUsd(t) > 0 ? fmtUsd(volUsd(t)) + " vol" : "new"}</span>
              </span>
            </Link>
          ))}
          {list.length === 0 && <div className="gm-empty">No launches yet. Be the first.</div>}
        </div>
      </div>
    );
  }

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
