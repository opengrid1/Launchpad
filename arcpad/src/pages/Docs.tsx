import { Link } from "react-router-dom";

import { Copy } from "../components/Copy";
import { Icon, type IconName } from "../components/Icon";
import { ADDRESSES, BRAND, env, FEES } from "../lib/env";

export default function Docs() {
  const steps: { icon: IconName; t: string; p: string }[] = [
    { icon: "launch", t: "Launch", p: "One transaction deploys a fixed 1B supply coin and puts all of it into a Uniswap V3 pool against USDC at about $3,000. Optional first buy in USDC. Liquidity is locked in the pool." },
    { icon: "receipt", t: "Trade in dollars", p: "Arc's gas token is USDC, so you pay USDC, receive USDC, and the price on the chart is a dollar price. No wrapped tokens, no gas token to buy first." },
    { icon: "wallet", t: "Creator gets paid", p: `Every trade pays the pool's ${FEES.taxPct}% fee. ${FEES.creatorPct}% of it belongs to the creator and ${FEES.platformPct}% to the platform. Collect any time, as USDC.` },
    { icon: "tune", t: "Nothing else", p: "No presale, no bonding curve, no tax on transfers, no holder rewards, no mint, no owner. The coin is done the moment it launches." },
  ];
  return (
    <main className="page">
      <section className="hero" style={{ paddingTop: 10 }}>
        <h1>Same rules for <em>every</em> coin.</h1>
        <p className="sub">One factory on Arc enforces all of it. A coin, a dollar pool, a fee that pays the creator.</p>
      </section>
      <section className="sec">
        <div className="sec-h"><h2>The loop</h2><span className="caps">Uniswap V3 · Arc mainnet</span></div>
        <div className="steps">{steps.map((s, i) => <div key={s.t} className="step"><div className="step-h"><span className="step-n">{i + 1}</span><Icon name={s.icon} size={20} /><h3>{s.t}</h3></div><p>{s.p}</p></div>)}</div>
      </section>
      <section className="sec">
        <div className="sec-h"><h2>Why Arc</h2></div>
        <div className="steps two">
          <div className="step"><div className="step-h"><Icon name="receipt" size={20} /><h3>Dollars all the way down</h3></div><p>Arc is Circle's Layer 1 where USDC is the native token. A coin here is priced in dollars from its first block, and fees arrive as dollars, not as a volatile gas token.</p></div>
          <div className="step"><div className="step-h"><Icon name="info" size={20} /><h3>Fast and final</h3></div><p>Sub-second finality and fees of a fraction of a cent. A launch, a buy and a fee collection all settle before you finish reading this sentence.</p></div>
        </div>
      </section>
      <section className="sec">
        <div className="sec-h"><h2>Fees and limits</h2></div>
        <div className="facts">
          <div><b>{FEES.taxPct}%</b><span>pool fee on every buy and sell, inside Uniswap. The only fee.</span></div>
          <div><b>{FEES.creatorPct}/{FEES.platformPct}</b><span>creator, platform. Accrues per trade in USDC, collected on demand.</span></div>
          <div><b>1B</b><span>fixed supply. No mint, no burn by anyone else, no owner, no proxy, no pause on the coin.</span></div>
        </div>
      </section>
      <section className="sec">
        <div className="sec-h"><h2>Contracts</h2><span className="caps">{env.chainName} · {env.chainId}</span></div>
        <div className="panel"><dl className="kv">
          <dt>Factory</dt><dd><Copy value={ADDRESSES.factory} full /></dd>
          <dt>Router</dt><dd><Copy value={ADDRESSES.router} full /></dd>
          <dt>USDC</dt><dd><Copy value={ADDRESSES.weth} full /></dd>
          <dt>X</dt><dd><a className="acc" href={BRAND.x} target="_blank" rel="noreferrer">{BRAND.x.replace("https://x.com/", "@")}</a></dd>
        </dl></div>
        <p className="note">Your holdings and launched coins are under <Link to="/me" className="acc">Portfolio</Link>.</p>
      </section>
    </main>
  );
}
