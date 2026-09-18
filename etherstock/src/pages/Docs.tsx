import { Link } from "react-router-dom";

import { Copy } from "../components/Copy";
import { ADDRESSES, BRAND, env, FEES } from "../lib/env";
import { useQuotes } from "../lib/hooks";

/** The rules, written as a numbered spec. One factory enforces every line. */
export default function Docs() {
  const { data: quotes } = useQuotes();
  const approved = quotes?.filter((q) => q.approved && !q.isNative) ?? [];
  const routable = approved.filter((q) => q.ethRoute);
  return (
    <main className="doc">
      <h1>The rules.</h1>
      <p className="lead">Every coin on Etherstock runs on the same contract with the same numbers. Nothing below is configurable per coin, by anyone.</p>

      <section>
        <div className="no">§1<small>launch</small></div>
        <div>
          <h2>One transaction, one pool, burned forever</h2>
          <p>Launching deploys a coin with a fixed 1,000,000,000 supply and puts all of it into a Uniswap V4 pool priced at about $3,000 of market cap, paired with ETH or a tokenized stock you pick. The liquidity is burned forever: the creator can never withdraw it. An optional first buy in ETH happens in the same transaction.</p>
        </div>
      </section>

      <section>
        <div className="no">§2<small>the fee</small></div>
        <div>
          <h2>{FEES.taxPct}% of the pair side, split three ways</h2>
          <div className="loop">
            <div><b>{FEES.taxPct}%</b><span>taken by the hook inside the pool on every buy and sell</span></div>
            <div><b>{FEES.creatorPct}%</b><span>to the creator, credited per trade, claimable any time</span></div>
            <div><b className="ember">{FEES.burnPct}%</b><span>into the coin's burn reserve</span></div>
            <div><b>{FEES.platformPct}%</b><span>to the platform</span></div>
          </div>
          <p>The fee is charged in the pair asset, so a coin paired with NVDAon collects NVDAon. The creator can claim it as the stock or, when the stock has an ETH route, straight as ETH.</p>
        </div>
      </section>

      <section>
        <div className="no">§3<small>the burn</small></div>
        <div>
          <h2>The reserve fills, then the next trade burns</h2>
          <p>Each coin keeps its own burn reserve in the pair asset. Once the reserve reaches about $25 at the pair's price on file, the very next trade spends the whole reserve buying the coin back from its own pool and burns what it bought, inside that same transaction. The buyback swap pays no fee. Anyone can also fire it early with the Burn now button, paying only gas.</p>
          <p>Burned coins are destroyed, not parked. Total supply falls, the market cap on the board is computed from the live supply, and nothing can ever be minted back.</p>
        </div>
      </section>

      <section>
        <div className="no">§4<small>trading</small></div>
        <div>
          <h2>Pay in ETH whatever the pair</h2>
          <p>The router takes ETH, swaps it into the stock through the stock's own pool, and into the coin, in one transaction, and back on the way out. {approved.length} stocks are approved and {routable.length} have a live on-chain pool. A stock without one can still be paired, but buyers must already hold it.</p>
        </div>
      </section>

      <section>
        <div className="no">§5<small>anti-snipe</small></div>
        <div>
          <h2>The first 20 seconds are expensive</h2>
          <p>The launch block is creator-only. For the first 20 seconds the fee starts at 99% and decays to {FEES.taxPct}%, with the surcharge going to the platform, and each wallet is capped at 3% of supply for three blocks. Bots pay for being first.</p>
        </div>
      </section>

      <section>
        <div className="no">§6<small>contracts</small></div>
        <div>
          <h2>Ethereum mainnet · chain {env.chainId}</h2>
          <dl className="addr">
            <dt>Factory</dt><dd><Copy value={ADDRESSES.factory} full /></dd>
            <dt>Hook</dt><dd><Copy value={ADDRESSES.hook} full /></dd>
            <dt>Router</dt><dd><Copy value={ADDRESSES.router} full /></dd>
            <dt>Pool manager</dt><dd><Copy value={ADDRESSES.poolManager} full /></dd>
            <dt>X</dt><dd><a className="ember" href={BRAND.x} target="_blank" rel="noreferrer">{BRAND.x.replace("https://x.com/", "@")}</a></dd>
          </dl>
          <p className="note">Source is verified on Etherscan. Your holdings, creator fees and launched coins are under <Link to="/me" className="ember">Portfolio</Link>.</p>
        </div>
      </section>
    </main>
  );
}
