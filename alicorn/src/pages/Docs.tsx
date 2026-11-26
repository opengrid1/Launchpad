import { Link } from "react-router-dom";

import { Copy } from "../components/Copy";
import { ADDRESSES, BRAND, env, FEES } from "../lib/env";
import { useQuotes } from "../lib/hooks";
import { isTokenPair } from "../lib/stocks";

export default function Docs() {
  const { data: quotes } = useQuotes();
  const approved = quotes?.filter((q) => q.approved && !q.isNative) ?? [];
  const tokens = approved.filter((q) => isTokenPair(q.address));
  const stocks = approved.filter((q) => !isTokenPair(q.address));
  const routable = approved.filter((q) => q.ethRoute);
  return (
    <main className="doc">
      <h1>Docs</h1>
      <p className="lead">Alicorn is a coin launchpad on Ethereum, built on Uniswap V4. Every coin is paired with an asset of the creator's choice, any ERC-20 with a Uniswap pool, and every trade pays the coin's holders in that asset. One factory, one set of rules for every coin.</p>

      <section>
        <h2>Pair assets</h2>
        <p>A coin is launched against a pair asset: ETH, a token like {tokens.slice(0, 4).map((t) => t.symbol).join(", ") || "UNI, LINK, PEPE"}, a tokenized stock like NVDAon, or any other ERC-20 on Ethereum. The pool holds the pair on the other side, so the coin is priced in it and every fee is collected in it. {tokens.length} tokens and {stocks.length} stocks are listed; {routable.length} have an on-chain route from ETH.</p>
        <p><b>Any token.</b> Paste a contract address on the launch page. If the token has a Uniswap V3 pool against WETH holding at least 1 WETH, the launch registers it in the same transaction: the pool's spot price (times Chainlink ETH/USD) sizes the opening pool and prices the coin, and the same pool is the ETH route for buys, sells and ETH claims. Tokens with up to 18 decimals work. The admin can block a token.</p>
        <p><b>Listed pairs</b> are curated by the admin with a USD price on file, from a Chainlink feed where one exists. Tokenized stocks trade against USDC rather than WETH, so they are listed this way.</p>
      </section>

      <section>
        <h2>Launch</h2>
        <p>A fixed 1,000,000,000 supply goes into a single Uniswap V4 pool at about $3,000 of market cap. The liquidity is burned: the creator can never withdraw it. An optional first buy in ETH happens in the same transaction. Name, ticker, pair and metadata are fixed at launch. No one can mint or pause the coin.</p>
      </section>

      <section>
        <h2>Fees</h2>
        <p>Every trade pays {FEES.taxPct}%, taken inside the pool on both buys and sells, in the pair asset.</p>
        <div className="split">
          <div className="vio"><b>{FEES.holderPct}%</b><span>to holders, credited as the trade settles</span></div>
          <div><b>{FEES.creatorPct}%</b><span>to the creator, claimable any time</span></div>
          <div><b>{FEES.platformPct}%</b><span>to the platform</span></div>
        </div>
        <p>Holder rewards use a per-share accumulator: hold the coin and your share accrues automatically. Nothing to stake and nothing to harvest. Claim in the pair asset, or as ETH when the pair has a route.</p>
      </section>

      <section>
        <h2>Trading in ETH</h2>
        <p>Whatever the pair, buyers can pay in ETH. The router swaps ETH into the pair through the pair's own Uniswap pool and then into the coin, in one transaction, and back on the way out. A pair without a route can still be used, but buyers must already hold it.</p>
      </section>

      <section>
        <h2>Launch protection</h2>
        <p>The launch block is creator-only. For the first 30 seconds the fee starts at 99% and decays to {FEES.taxPct}%, with the surcharge going to the platform. Each wallet is capped at 1% of supply for ten blocks.</p>
      </section>

      <section>
        <h2>Contracts</h2>
        <div className="card" style={{ padding: 14, marginTop: 8 }}>
          <dl className="kv" style={{ gridTemplateColumns: "120px 1fr" }}>
            <dt>Chain</dt><dd style={{ textAlign: "left" }}>Ethereum mainnet ({env.chainId})</dd>
            <dt>Factory</dt><dd style={{ textAlign: "left" }}><Copy value={ADDRESSES.factory} full /></dd>
            <dt>Pair registry</dt><dd style={{ textAlign: "left" }}><Copy value={ADDRESSES.pairs} full /></dd>
            <dt>Hook</dt><dd style={{ textAlign: "left" }}><Copy value={ADDRESSES.hook} full /></dd>
            <dt>Router</dt><dd style={{ textAlign: "left" }}><Copy value={ADDRESSES.router} full /></dd>
            <dt>Pool manager</dt><dd style={{ textAlign: "left" }}><Copy value={ADDRESSES.poolManager} full /></dd>
            <dt>X</dt><dd style={{ textAlign: "left" }}><a className="vi" href={BRAND.x} target="_blank" rel="noreferrer">{BRAND.x.replace("https://x.com/", "@")}</a></dd>
          </dl>
        </div>
        <p className="note">Source verified on Etherscan. Your holdings and claims are under <Link to="/me" className="vi">Rewards</Link>.</p>
      </section>
    </main>
  );
}
