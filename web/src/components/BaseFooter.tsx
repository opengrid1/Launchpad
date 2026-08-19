import { Link } from "react-router-dom";

import { BRAND } from "../lib/brand";
import { env } from "../lib/env";
import { BASE_STOCKS } from "../lib/base/stocks";

const HUE: Record<string, number> = {
  NVDA: 140, AAPL: 212, GOOGL: 18, META: 224, AMZN: 32, QQQ: 286, COIN: 226, MSTR: 190, SPY: 45,
};

/**
 * stonkpad's own footer: a branded closing band that showcases the assets
 * holders can earn, with product links. Distinct from the heist flavor's slim
 * footer.
 */
export function BaseFooter() {
  return (
    <footer className="dvf">
      <div className="dvf-inner">
        <div className="dvf-top">
          <div>
            <Link to="/" className="dvf-mark"><span aria-hidden>◎</span>{BRAND.name}<span className="dvf-tld">{BRAND.tld}</span></Link>
            <p className="dvf-tag">{BRAND.tagline}. Built on Base.</p>
          </div>
          <nav className="dvf-links" aria-label="Footer">
            <Link to="/launch">Launch</Link>
            <Link to="/docs">Docs</Link>
            <a href={BRAND.twitter} target="_blank" rel="noreferrer">X</a>
            {env.explorerUrl && <a href={env.explorerUrl} target="_blank" rel="noreferrer">Explorer</a>}
          </nav>
        </div>

        <div className="dvf-earn">
          <span className="dvf-earn-label">Earn</span>
          {BASE_STOCKS.map((s) => (
            <span key={s.symbol} className="dvf-earn-chip" style={{ ["--h" as any]: HUE[s.symbol] ?? 210 }}>{s.symbol}</span>
          ))}
        </div>

        <div className="dvf-legal">
          <span>© {env.chainName} · {BRAND.domain}</span>
          <span>Trade responsibly. Coins are experimental.</span>
        </div>
      </div>
    </footer>
  );
}
