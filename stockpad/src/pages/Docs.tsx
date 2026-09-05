import { Link } from "react-router-dom";

import { Copy } from "../components/Copy";
import { Icon, type IconName } from "../components/Icon";
import { ADDRESSES, BRAND, env, FEES } from "../lib/env";
import { useQuotes } from "../lib/hooks";

export default function Docs() {
  const { data: quotes } = useQuotes();
  const approved = quotes?.filter((q) => q.approved && !q.isNative) ?? [];
  const routable = approved.filter((q) => q.ethRoute);
  const steps: { icon: IconName; t: string; p: string }[] = [
    { icon: "launch", t: "Launch", p: "One transaction deploys a fixed 1B supply coin and puts all of it into a Uniswap V4 pool at about $3,000, paired with ETH or a tokenized stock you pick. Optional first buy in ETH. No withdraw path for the liquidity." },
    { icon: "receipt", t: "Trade in ETH", p: "You pay and receive ETH whatever the pair. The router swaps ETH into the stock through the stock's own pool and into the coin in one transaction, and back on the way out." },
    { icon: "wallet", t: "Earn on every swap", p: `Every trade pays ${FEES.taxPct}% of the pair side. ${FEES.creatorPct}% to the creator, ${FEES.holderPct}% credited to holders on the spot, ${FEES.platformPct}% to the platform. No harvest. Claim any time, as the stock or as ETH.` },
    { icon: "tune", t: "No sniping", p: `For the first 20 seconds the fee starts at 99% and decays to ${FEES.taxPct}%, with the surcharge going to the platform, and each wallet is capped at 3% of supply for three blocks. The launch block is creator-only.` },
  ];
  return (
    <main className="page">
      <section className="hero" style={{ paddingTop: 10 }}>
        <h1>Same rules for <em>every</em> coin.</h1>
        <p className="sub">One factory on Ethereum enforces all of it. A coin, a pool, a fee that pays three ways.</p>
      </section>
      <section className="sec">
        <div className="sec-h"><h2>The loop</h2><span className="caps">Uniswap V4 · Ethereum mainnet</span></div>
        <div className="steps">{steps.map((s, i) => <div key={s.t} className="step"><div className="step-h"><span className="step-n">{i + 1}</span><Icon name={s.icon} size={20} /><h3>{s.t}</h3></div><p>{s.p}</p></div>)}</div>
      </section>
      <section className="sec">
        <div className="sec-h"><h2>Stock pairs</h2><span className="caps">{approved.length} approved · {routable.length} tradeable in ETH</span></div>
        <div className="steps two">
          <div className="step"><div className="step-h"><Icon name="receipt" size={20} /><h3>What a pair means</h3></div><p>The pool holds the stock on the other side, so the coin's price is quoted in that stock and every fee arrives in it. A coin paired with NVDAon is a bet denominated in NVIDIA.</p></div>
          <div className="step"><div className="step-h"><Icon name="info" size={20} /><h3>Which stocks work</h3></div><p>Ondo's tokenized stocks live on Ethereum, but only some have a real pool today. Pairs marked "tradeable in ETH" have one, so buyers pay ETH. The rest can be paired, but buyers must already hold the stock.</p></div>
        </div>
      </section>
      <section className="sec">
        <div className="sec-h"><h2>Fees and limits</h2></div>
        <div className="facts">
          <div><b>{FEES.taxPct}%</b><span>of the pair side on every buy and sell, taken inside the pool by the hook. The only fee.</span></div>
          <div><b>{FEES.creatorPct}/{FEES.holderPct}/{FEES.platformPct}</b><span>creator, holders, platform. Credited per trade, no harvest.</span></div>
          <div><b>1B</b><span>fixed supply. No mint, no burn, no owner, no proxy, no pause on the coin.</span></div>
        </div>
      </section>
      <section className="sec">
        <div className="sec-h"><h2>Contracts</h2><span className="caps">{env.chainName} · {env.chainId}</span></div>
        <div className="panel"><dl className="kv">
          <dt>Factory</dt><dd><Copy value={ADDRESSES.factory} full /></dd>
          <dt>Hook</dt><dd><Copy value={ADDRESSES.hook} full /></dd>
          <dt>Router</dt><dd><Copy value={ADDRESSES.router} full /></dd>
          <dt>Pool manager</dt><dd><Copy value={ADDRESSES.poolManager} full /></dd>
          <dt>X</dt><dd><a className="acc" href={BRAND.x} target="_blank" rel="noreferrer">{BRAND.x.replace("https://x.com/", "@")}</a></dd>
        </dl></div>
        <p className="note">Your holdings, rewards and launched coins are under <Link to="/me" className="acc">Mine</Link>.</p>
      </section>
    </main>
  );
}
