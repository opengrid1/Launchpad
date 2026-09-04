import { Link } from "react-router-dom";

import { Copy } from "../components/Copy";
import { Icon, type IconName } from "../components/Icon";
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

  const auction: { icon: IconName; t: string; p: string }[] = [
    { icon: "launch", t: "Launch", p: `The creator deploys the coin. Half of the one billion supply goes into the auction house; the other half waits for the pool. The floor is ${floor} FDV. Optional opening bid.` },
    { icon: "gavel", t: "Bid", p: `A bid is a HYPE budget and a max price, minimum ${minBid} HYPE. The budget is spread evenly over the ${len} left, so being early beats being fast. Bids cannot be withdrawn.` },
    { icon: "receipt", t: "Clear", p: "Coins are released evenly every block. Each block clears at one price: the lowest at which that block's coins cover every bid at or above it. Everyone active pays the same. The price only rises." },
    { icon: "check", t: "Settle", p: `At ${bond} HYPE or more the raise and the unsold half seed a locked HyperSwap pool at the clearing price, and bidders claim their coins. Below ${bond} HYPE nothing is sold and every bid is refunded in full.` },
  ];

  return (
    <main className="page">
      <section className="hero" style={{ gridTemplateColumns: "1fr", paddingBottom: 6 }}>
        <div>
          <div className="lbl" style={{ marginBottom: 12 }}>How it works</div>
          <h1>Same rules<br />for <em>every</em> coin.</h1>
          <p className="sub">One factory contract on HyperEVM enforces all of it. Two ways to launch, one fee.</p>
        </div>
      </section>

      <section className="sec">
        <div className="sec-h"><h2>Auction</h2><span className="lbl">{len} · one price for everyone</span></div>
        <div className="steps">
          {auction.map((s, i) => (
            <div key={s.t} className="step">
              <div className="step-h"><span className="step-n">{i + 1}</span><Icon name={s.icon} size={20} /><h3>{s.t}</h3></div>
              <p>{s.p}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="sec">
        <div className="sec-h"><h2>Instant</h2><span className="lbl">trading in one block</span></div>
        <div className="steps two">
          <div className="step">
            <div className="step-h"><Icon name="launch" size={20} /><h3>Launch and trade</h3></div>
            <p>One transaction deploys the coin, opens the pool and seeds it with the whole supply at about {floor} FDV. Trading starts in the same block, and you can add a first buy in that transaction.</p>
          </div>
          <div className="step">
            <div className="step-h"><Icon name="tune" size={20} /><h3>Big blocks</h3></div>
            <p>Opening a pool needs HyperEVM big blocks on for your wallet: Hyperliquid app → "Use big blocks for EVM". Turn them off again after. Auctions do not need this.</p>
          </div>
        </div>
      </section>

      <section className="sec">
        <div className="sec-h"><h2>Fees and limits</h2></div>
        <div className="facts">
          <div><b>{FEES.poolPct}%</b><span>fee on every buy and sell, into the pool. The only fee.</span></div>
          <div><b>{FEES.creatorPct}%</b><span>of it to the creator, {FEES.platformPct}% to the platform, split on-chain whenever anyone presses Harvest. Paid in HYPE.</span></div>
          <div><b>1B</b><span>fixed supply. No mint, no burn, no owner functions on the coin.</span></div>
          <div><b>0</b><span>limits. No max transaction, no max wallet, no cooldown. Quotes simulate the real swap, so "you get" includes price impact.</span></div>
        </div>
      </section>

      <section className="sec">
        <div className="sec-h"><h2>Contracts</h2><span className="lbl">{env.chainName} · {env.chainId}</span></div>
        <div className="panel">
          <dl className="specs">
            <dt>Factory</dt><dd><Copy value={ADDRESSES.factory} full /></dd>
            <dt>Auction house</dt><dd><Copy value={ADDRESSES.house} full /></dd>
            <dt>Token deployer</dt><dd><Copy value={ADDRESSES.tokenDeployer} full /></dd>
            <dt>Swap router</dt><dd><Copy value={ADDRESSES.swapRouter} full /></dd>
            <dt>Pair</dt><dd>WHYPE</dd>
          </dl>
        </div>
        <p className="small" style={{ marginTop: 14 }}>Your bids, claims and coins are under <Link to="/me" style={{ color: "var(--green)" }}>My bids</Link>.</p>
      </section>
    </main>
  );
}
