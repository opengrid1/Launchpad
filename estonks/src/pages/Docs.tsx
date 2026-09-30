import { Link } from "react-router-dom";

import { Copy } from "../components/Copy";
import { ADDRESSES, env, FEES, MAIN_TOKEN } from "../lib/env";

const V1_FACTORY = "0x12f4d0eAEe4ea0cEf7722aF00989D5210417DaD9";
const pctOf = (share: number) => ((FEES.taxPct * share) / 100).toFixed(1);

const CONTRACTS: { name: string; address: string; what: string }[] = [
  { name: "Factory", address: ADDRESSES.factory, what: "Launches coins, seeds their pools, holds the listings." },
  { name: "Hook", address: ADDRESSES.hook, what: "Takes the fixed fee on every swap and sends it to the coin." },
  { name: "Router", address: ADDRESSES.router, what: "Buys and sells in ETH, and pays claims as ETH or a stock basket." },
  { name: "Token deployer", address: ADDRESSES.tokenDeployer, what: "Creates each coin contract for the factory." },
  { name: "Uniswap V4 PoolManager", address: ADDRESSES.poolManager, what: "Uniswap's contract that holds every pool." },
];

const Addr = ({ a }: { a: string }) => (
  <span className="docs-addr"><Copy value={a} /><a href={`${env.explorerUrl}/address/${a}`} target="_blank" rel="noreferrer">Etherscan</a></span>
);

/** How Estonks works: launches, fees, rewards, baskets, launch protection, contracts. */
export default function Docs() {
  return (
    <main className="docs">
      <div style={{ paddingTop: 14 }}>
        <h1>Docs.</h1>
        <p className="lede">How Estonks works and what every fee pays.</p>
      </div>

      <section>
        <h2>What Estonks is</h2>
        <p>Estonks launches meme coins on Ethereum. Every coin gets its own Uniswap V4 pool, paired with ETH or with a tokenized stock from Ondo Global Markets. Every trade pays a fee, and the fee pays the people around the coin: the creator, the coin's holders, and STONK holders.</p>
      </section>

      <section>
        <h2>Launching a coin</h2>
        <p>One transaction creates the coin, its pool and its listing. The whole supply of 1,000,000,000 goes into the pool as single-sided liquidity, starting at a market cap of about $3,000. There is no team allocation and no presale.</p>
        <p>The creator picks the pair: ETH, or one of the stocks listed on the launch page. The creator can also make a first buy in ETH in the same transaction. For a stock pair, that ETH is swapped into the stock along the best known route, with a price floor so it can't be sandwiched.</p>
      </section>

      <section>
        <h2>Fees</h2>
        <p>Every buy and sell pays {FEES.taxPct}% of the pair side of the trade. The fee is set when the pool is created and no function can change it.</p>
        <div className="card">
          <div className="kv"><span><i className="sw" style={{ background: "#ffab7a" }} />Creator</span><b>{pctOf(FEES.creatorPct)}% of each trade</b></div>
          <div className="kv"><span><i className="sw" style={{ background: "#9b7dff" }} />Coin holders</span><b>{pctOf(FEES.holderPct)}% of each trade</b></div>
          <div className="kv"><span><i className="sw" style={{ background: "#e3b657" }} />STONK holders</span><b>{pctOf(FEES.platformPct)}% of each trade</b></div>
        </div>
        <p>Fees are paid in the pair asset, so a coin paired with NVDAon pays its fees in NVDAon. Anyone can push the creator's share to the creator and the platform share to the fee recipient; nobody else can receive them.</p>
      </section>

      <section>
        <h2>Holder rewards</h2>
        <p>The holder share is credited to every holder on every trade, in proportion to how many coins they hold. Nothing to stake: hold the coin in your wallet and it earns. The pool and the launchpad's own contracts don't earn.</p>
        <p>Claim from the coin page or claim everything at once from your portfolio. Rewards can be taken in the pair asset, as ETH, or as the coin's stock basket if it has one.</p>
      </section>

      <section>
        <h2>Basket rewards</h2>
        <p>When launching, the creator can pick up to 4 stocks as the coin's rewards basket. The basket is written into the coin contract and can never change.</p>
        <p>A holder who claims as the basket gets equal parts of those stocks. They are bought at the moment of the claim, and each stock has its own price floor set by the person claiming (5% on this site), so no one else can set the price they get. If a stock can't be bought at that moment, the claim reverts and nothing is lost: claim again later, or take the pair asset or ETH instead.</p>
        <p>A coin paired with ETH can pick a single stock, so its holders earn that stock. A coin paired with a stock can include its own pair; that part is handed over without a swap.</p>
      </section>

      <section>
        <h2>Launch protection</h2>
        <div className="card">
          <div className="kv"><span>Launch block</span><b>Only the creator can buy</b></div>
          <div className="kv"><span>Next 3 blocks</span><b>Max 3% of supply bought or held per wallet</b></div>
          <div className="kv"><span>First 20 seconds</span><b>Fee starts at 99% and falls to {FEES.taxPct}%</b></div>
        </div>
        <p>The extra fee during the first 20 seconds is split like any other fee, so snipers pay the coin's holders and creator.</p>
      </section>

      <section>
        <h2>STONK</h2>
        <p>STONK is the main token. The platform share of every coin, {pctOf(FEES.platformPct)}% of each trade, goes to a distributor contract that passes it to STONK holders as rewards. Holding STONK earns from every coin launched on Estonks.</p>
        {MAIN_TOKEN ? <p>STONK: <Addr a={MAIN_TOKEN} /></p> : <p>STONK is being relaunched on v2. Its address will be listed here.</p>}
      </section>

      <section>
        <h2>Contracts</h2>
        <p>All verified on Etherscan. Ethereum mainnet.</p>
        <div className="card docs-contracts">
          {CONTRACTS.map((c) => (
            <div key={c.address} className="docs-c"><div><b>{c.name}</b><small>{c.what}</small></div><Addr a={c.address} /></div>
          ))}
        </div>
      </section>

      <section>
        <h2>Why v2</h2>
        <p>The first factory had a function that could change a coin's fee, up to 10%. It was never used; every coin paid 2%. Scanners still flagged it, along with the internal calls the old coins made for fee payouts. v2 removes both: fees are fixed per pool and coin contracts have no privileged callers.</p>
        <p>Coins from the first factory keep trading on Uniswap but are no longer listed here. Old factory: <Addr a={V1_FACTORY} /></p>
      </section>

      <section>
        <h2>Risks</h2>
        <p>Meme coins are volatile and most go to zero. Stock pairs depend on Ondo's tokenized stocks and on the on-chain liquidity for them, which is thin for some; a thin market can make a stock claim or an ETH trade fail until liquidity returns. The contracts have been tested on a mainnet fork and checked with static analysis, but have not had a third-party audit.</p>
      </section>

      <p className="note"><Link to="/launch">Launch a coin</Link> · <Link to="/">Browse coins</Link></p>
    </main>
  );
}
