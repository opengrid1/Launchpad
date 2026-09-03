import { Link } from "react-router-dom";

import { ADDRESSES, env } from "../lib/env";

export default function Docs() {
  return (
    <main className="page">
      <section className="hero" style={{ gridTemplateColumns: "1fr", paddingBottom: 6 }}>
        <div>
          <div className="lbl" style={{ marginBottom: 12 }}>Rules of the station</div>
          <h1>Same rules<br />for <em>every</em> coin.</h1>
          <p className="sub">One factory contract on HyperEVM enforces all of it. Nothing to configure, nothing to trust.</p>
        </div>
      </section>

      <div className="rule"><b>$0</b><div><h3>Free to launch</h3><p>One transaction deploys the token, opens a HyperSwap pool against HYPE and seeds it single-sided with the whole supply at about a $3,000 market cap. You pay gas only. You can add a first buy in the same transaction.</p></div></div>
      <div className="rule"><b>1B</b><div><h3>Fixed supply</h3><p>One billion tokens, every time. No mint, no burn, no owner functions.</p></div></div>
      <div className="rule"><b>1%</b><div><h3>One fee</h3><p>Every buy and sell pays 1% into the pool. Fees collect there and are split on-chain whenever anyone presses Harvest: 50% to holders pro-rata, 40% to the creator, 10% to the platform. Paid in HYPE.</p></div></div>
      <div className="rule"><b>∞</b><div><h3>Liquidity locked</h3><p>The pool position is held by the factory forever. Not the creator, not us, nobody can pull it.</p></div></div>
      <div className="rule"><b>0</b><div><h3>No limits</h3><p>No max transaction, no max wallet, no cooldown, no graduation gate. Trades route through HyperSwap's router. Quotes here simulate the real swap from your wallet, so "you get" already includes price impact.</p></div></div>
      <div className="rule"><b>1×</b><div><h3>One-time setup</h3><p>Launching deploys contracts, which needs HyperEVM <b style={{ color: "var(--ink)" }}>big blocks</b> enabled on your wallet. In the Hyperliquid app turn on "Use big blocks for EVM", go live, then turn it off again. Big blocks confirm about once a minute.</p></div></div>

      <section className="sec">
        <div className="sec-h"><h2>Contracts</h2></div>
        <div className="panel">
          <dl className="specs">
            <dt>Factory</dt><dd><a href={`${env.explorerUrl}/address/${ADDRESSES.factory}`} target="_blank" rel="noreferrer">{ADDRESSES.factory}</a></dd>
            <dt>Token deployer</dt><dd><a href={`${env.explorerUrl}/address/${ADDRESSES.tokenDeployer}`} target="_blank" rel="noreferrer">{ADDRESSES.tokenDeployer}</a></dd>
            <dt>Swap router</dt><dd><a href={`${env.explorerUrl}/address/${ADDRESSES.swapRouter}`} target="_blank" rel="noreferrer">{ADDRESSES.swapRouter}</a></dd>
            <dt>Pair</dt><dd>WHYPE</dd>
            <dt>Chain</dt><dd>{env.chainName} · {env.chainId}</dd>
          </dl>
        </div>
        <p className="small" style={{ marginTop: 14 }}>Holder rewards wait until you claim them, from a coin's page or your <Link to="/me" style={{ color: "var(--green)" }}>Studio</Link>.</p>
      </section>
    </main>
  );
}
