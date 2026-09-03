import { Link } from "react-router-dom";

import { ADDRESSES, env, FEES } from "../lib/env";
import { usd, wei } from "../lib/format";
import { useConfig } from "../lib/hooks";
import { countdown } from "../lib/onair";

export default function Docs() {
  const { data: cfg } = useConfig();
  const floor = cfg ? usd(Number(cfg.floorMcapUsd8) / 1e8, { compact: true }) : "$3.0K";
  const bond = cfg ? wei(cfg.minRaiseWei) : 220;
  const len = cfg ? countdown(cfg.durationBlocks) : "4h 00m";
  const minBid = cfg ? wei(cfg.minBidWei) : 0.05;
  return (
    <main className="page">
      <section className="hero" style={{ gridTemplateColumns: "1fr", paddingBottom: 6 }}>
        <div>
          <div className="lbl" style={{ marginBottom: 12 }}>How it works</div>
          <h1>Same rules<br />for <em>every</em> coin.</h1>
          <p className="sub">One factory contract on HyperEVM enforces all of it. Two ways to launch, one fee, liquidity that never leaves.</p>
        </div>
      </section>

      <div className="rule"><b>1B</b><div><h3>Fixed supply</h3><p>One billion tokens, every time. No mint, no burn, no owner functions on the coin. Every coin pairs with HYPE on HyperSwap's 1% tier.</p></div></div>
      <div className="rule"><b>{len.split(" ")[0]}</b><div><h3>Auction</h3><p>Half the supply is released evenly over {len}, and sold at one clearing price per block: the lowest price at which that block's coins cover every bid at or above it. Everyone active in a block pays the same. The price only rises, so earlier bidders average a lower price. A bid is a HYPE budget and a max price; the budget is spread evenly over the blocks left, so being early beats being fast. Once the price passes your max you stop filling and the rest of your budget comes back at the end. Bids cannot be withdrawn and there is nothing to sell until the auction settles. Minimum bid {minBid} HYPE.</p></div></div>
      <div className="rule"><b>{bond}</b><div><h3>HYPE to bond</h3><p>An auction that raises {bond} HYPE or more graduates: the raise and the unsold half of the supply seed a locked pool at the clearing price, and bidders claim their coins. Below {bond} HYPE nothing is sold, no pool opens, and every bidder claims a full refund. Settlement runs a few minutes after the end block; anyone can trigger it.</p></div></div>
      <div className="rule"><b>⚡</b><div><h3>Instant</h3><p>One transaction deploys the coin, opens the pool and seeds it single-sided with the whole supply at about {floor} FDV. Trading starts in the same block. You can add a first buy in the same transaction. Opening a pool needs HyperEVM <b style={{ color: "var(--ink)" }}>big blocks</b> on for your wallet (Hyperliquid app → "Use big blocks for EVM"); turn them off again after.</p></div></div>
      <div className="rule"><b>{FEES.poolPct}%</b><div><h3>One fee</h3><p>Every buy and sell pays {FEES.poolPct}% into the pool. Fees collect there and are split on-chain whenever anyone presses Harvest: {FEES.creatorPct}% to the creator, {FEES.platformPct}% to the platform. Paid in HYPE.</p></div></div>
      <div className="rule"><b>∞</b><div><h3>Liquidity locked</h3><p>The pool position is held by the factory. Creators can never pull it. The platform can, and says so here: the owner can collect liquidity, and while an auction runs the owner can take HYPE out of escrow (spent HYPE, or everything). Nothing about that is hidden; every call is on-chain and shown on the coin's page.</p></div></div>
      <div className="rule"><b>0</b><div><h3>No limits</h3><p>No max transaction, no max wallet, no cooldown. Trades route through HyperSwap's router. Quotes here simulate the real swap from your wallet, so "you get" already includes price impact.</p></div></div>

      <section className="sec">
        <div className="sec-h"><h2>Contracts</h2></div>
        <div className="panel">
          <dl className="specs">
            <dt>Factory</dt><dd><a href={`${env.explorerUrl}/address/${ADDRESSES.factory}`} target="_blank" rel="noreferrer">{ADDRESSES.factory}</a></dd>
            <dt>Auction house</dt><dd><a href={`${env.explorerUrl}/address/${ADDRESSES.house}`} target="_blank" rel="noreferrer">{ADDRESSES.house}</a></dd>
            <dt>Token deployer</dt><dd><a href={`${env.explorerUrl}/address/${ADDRESSES.tokenDeployer}`} target="_blank" rel="noreferrer">{ADDRESSES.tokenDeployer}</a></dd>
            <dt>Swap router</dt><dd><a href={`${env.explorerUrl}/address/${ADDRESSES.swapRouter}`} target="_blank" rel="noreferrer">{ADDRESSES.swapRouter}</a></dd>
            <dt>Pair</dt><dd>WHYPE</dd>
            <dt>Chain</dt><dd>{env.chainName} · {env.chainId}</dd>
          </dl>
        </div>
        <p className="small" style={{ marginTop: 14 }}>Your bids, claims and coins are under <Link to="/me" style={{ color: "var(--green)" }}>My bids</Link>.</p>
      </section>
    </main>
  );
}
