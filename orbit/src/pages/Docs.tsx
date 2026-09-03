import { Link } from "react-router-dom";

import { ADDRESSES, env } from "../lib/env";

export default function Docs() {
  return (
    <main className="page">
      <section className="hero" style={{ textAlign: "left", paddingBottom: 10 }}>
        <div className="eyebrow">How it works</div>
        <h1 style={{ margin: "0 0 14px" }}>Simple rules. No surprises.</h1>
        <p className="sub" style={{ margin: 0, textAlign: "left" }}>Every coin here follows the same fixed rules, enforced by one factory contract on HyperEVM. Nothing to configure, nothing to trust.</p>
      </section>

      <div className="features">
        <div className="feature"><div className="big">1B</div><p>Fixed supply for every coin. No mint, no burn, no owner functions.</p></div>
        <div className="feature"><div className="big">$0</div><p>Launch cost. The whole supply is seeded single-sided into a HyperSwap pool at about a $3,000 market cap.</p></div>
        <div className="feature"><div className="big">1%</div><p>Trade fee, paid inside every buy and sell. It is the only fee.</p></div>
        <div className="feature"><div className="big">∞</div><p>The liquidity position is held by the factory and can never be withdrawn.</p></div>
      </div>

      <section className="section">
        <h2>Where the 1% goes</h2>
        <p className="sub" style={{ marginBottom: 14 }}>Fees collect in the pool and are split on-chain whenever anyone presses Harvest. Paid in HYPE.</p>
        <dl className="specs" style={{ maxWidth: 560 }}>
          <dt>Holders</dt><dd>50% · pro-rata to everyone holding the coin</dd>
          <dt>Creator</dt><dd>40% · for as long as the coin trades</dd>
          <dt>Platform</dt><dd>10%</dd>
        </dl>
        <p className="small" style={{ marginTop: 12 }}>Holder rewards accrue per wallet and wait until you claim them from the coin's page or <Link to="/me">your page</Link>. Nothing is auto-sent.</p>
      </section>

      <section className="section">
        <h2>Launching</h2>
        <p className="sub" style={{ marginBottom: 14 }}>One transaction deploys the token, opens the pool, seeds it and starts trading. You can add a first buy in the same transaction.</p>
        <p className="small">One-time setup: launching deploys contracts, which needs HyperEVM <b>big blocks</b> enabled on your wallet. In the Hyperliquid app turn on "Use big blocks for EVM", launch, then turn it off again (big blocks confirm about once a minute).</p>
      </section>

      <section className="section">
        <h2>Trading</h2>
        <p className="sub" style={{ marginBottom: 14 }}>Trades route through HyperSwap's router against the coin's HYPE pool. No max transaction, no max wallet, no cooldown, no graduation gate.</p>
        <p className="small">Quotes on this site simulate the real swap from your wallet, so "you receive" already includes price impact. The slippage floor is capped to that fill.</p>
      </section>

      <section className="section">
        <h2>Contracts</h2>
        <dl className="specs" style={{ maxWidth: 640, fontSize: 14 }}>
          <dt>Factory</dt><dd><a href={`${env.explorerUrl}/address/${ADDRESSES.factory}`} target="_blank" rel="noreferrer">{ADDRESSES.factory}</a></dd>
          <dt>Token deployer</dt><dd><a href={`${env.explorerUrl}/address/${ADDRESSES.tokenDeployer}`} target="_blank" rel="noreferrer">{ADDRESSES.tokenDeployer}</a></dd>
          <dt>Swap router</dt><dd><a href={`${env.explorerUrl}/address/${ADDRESSES.swapRouter}`} target="_blank" rel="noreferrer">{ADDRESSES.swapRouter}</a></dd>
          <dt>Pair</dt><dd>WHYPE {ADDRESSES.quote}</dd>
          <dt>Chain</dt><dd>{env.chainName} · id {env.chainId}</dd>
        </dl>
      </section>
    </main>
  );
}
