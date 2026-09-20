import { Link } from "react-router-dom";

import { Copy } from "../components/Copy";
import { ADDRESSES, BRAND, env, FEES } from "../lib/env";
import { useQuotes } from "../lib/hooks";
import { isTokenPair } from "../lib/stocks";

/** The terms, in the order money moves. */
export default function Docs() {
  const { data: quotes } = useQuotes();
  const approved = quotes?.filter((q) => q.approved && !q.isNative) ?? [];
  const tokens = approved.filter((q) => isTokenPair(q.address));
  const stocks = approved.filter((q) => !isTokenPair(q.address));
  const routable = approved.filter((q) => q.ethRoute);
  return (
    <main className="doc">
      <div className="eyebrow">Ethereum mainnet · Uniswap V4</div>
      <h1 style={{ marginTop: 12 }}>The <em>terms</em>.</h1>
      <p className="lead">One factory, one set of numbers for every coin. Nothing below can be changed per coin, by anyone.</p>

      <section>
        <div className="n">1</div>
        <div>
          <h2>Pick a pair. Any approved asset.</h2>
          <p>A coin is launched against a pair asset: ETH, a plain token like {tokens.slice(0, 4).map((t) => t.symbol).join(", ") || "UNI, LINK, PEPE"}, or a tokenized stock like NVDAon. The pool holds the pair on the other side, so the coin is priced in it and every fee arrives in it. {tokens.length} tokens and {stocks.length} stocks are approved; {routable.length} have an on-chain route from ETH.</p>
          <p>Pairs are curated by the admin: each needs 18 decimals and a USD price on file, from a Chainlink feed where one exists, because the price sizes the $3,000 opening pool.</p>
        </div>
      </section>

      <section>
        <div className="n">2</div>
        <div>
          <h2>Launch in one transaction</h2>
          <p>A fixed 1,000,000,000 supply goes into a single Uniswap V4 pool at about $3,000 of market cap. The liquidity is burned forever: the creator can never withdraw it. An optional first buy in ETH lands in the same transaction.</p>
        </div>
      </section>

      <section>
        <div className="n">3</div>
        <div>
          <h2>Every trade pays {FEES.taxPct}%, split three ways</h2>
          <div className="split">
            <div className="vio"><b>{FEES.holderPct}%</b><span>to holders, in the pair asset, as the trade settles</span></div>
            <div><b>{FEES.creatorPct}%</b><span>to the creator, claimable any time</span></div>
            <div><b>{FEES.platformPct}%</b><span>to the platform</span></div>
          </div>
          <p>The hook takes the fee inside the pool on both buys and sells and credits it on the spot with a per-share accumulator. Nothing to stake, nothing to harvest: hold the coin and your share accrues; claim it whenever you like, in the pair or straight as ETH when the pair has a route.</p>
        </div>
      </section>

      <section>
        <div className="n">4</div>
        <div>
          <h2>Trade in plain ETH whatever the pair</h2>
          <p>The router takes ETH, swaps it into the pair through the pair's own Uniswap pool and into the coin, in one transaction, and back on the way out. A pair without a route can still be used, but buyers must already hold it.</p>
        </div>
      </section>

      <section>
        <div className="n">5</div>
        <div>
          <h2>The first 30 seconds are expensive</h2>
          <p>The launch block is creator-only. For the first 30 seconds the fee starts at 99% and decays to {FEES.taxPct}%, with the surcharge going to the platform, and each wallet is capped at 1% of supply for ten blocks. Bots pay for being first.</p>
        </div>
      </section>

      <section>
        <div className="n">6</div>
        <div>
          <h2>Contracts · chain {env.chainId}</h2>
          <dl className="kv" style={{ marginTop: 6 }}>
            <dt>Factory</dt><dd><Copy value={ADDRESSES.factory} full /></dd>
            <dt>Hook</dt><dd><Copy value={ADDRESSES.hook} full /></dd>
            <dt>Router</dt><dd><Copy value={ADDRESSES.router} full /></dd>
            <dt>Pool mgr</dt><dd><Copy value={ADDRESSES.poolManager} full /></dd>
            <dt>X</dt><dd><a className="vi" href={BRAND.x} target="_blank" rel="noreferrer">{BRAND.x.replace("https://x.com/", "@")}</a></dd>
          </dl>
          <p className="note">Source verified on Etherscan. Your holdings and claims are under <Link to="/me" className="vi">Statement</Link>.</p>
        </div>
      </section>
    </main>
  );
}
