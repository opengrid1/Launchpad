import { BRAND, env, RULES } from "../lib/env";
import { useConfig } from "../lib/hooks";

export default function Docs() {
  const { data: cfg } = useConfig();
  return (
    <main className="docs">
      <div className="launch-head"><h1>How it works</h1><p className="sub">One token, one screen, one tap to buy. Everything a coin does is in its own contract on NEAR.</p></div>
      <div className="card"><div className="card-b docs-b">
        <h2>The coin</h2>
        <p>Every coin is its own NEAR account running the same published code. It holds the token, its price, its liquidity and its tax. You pay in the coin's pair and you are paid in it: NEAR, unless the coin was made with another pair.</p>
        <h2>The curve</h2>
        <p>Each launch mints {RULES.supply.toLocaleString()} tokens once and never mints again. {RULES.curveSupply.toLocaleString()} sell on a bonding curve inside the contract; the other {RULES.poolSupply.toLocaleString()} are held back to open the pool. The curve behaves like a pool that already holds 1,000 NEAR and 1,125,000,000 tokens, so the first buyer meets a real price. The last token on the curve costs nine times the first, and the curve raises exactly 2,000 NEAR on a NEAR coin. Other pairs run the same curve in their own units.</p>
        <h2>Graduation</h2>
        <p>When the last token on the curve sells, the pool opens in the same contract at the last curve price, with everything the curve raised and the tokens held back. The coin holds the position; only the platform can withdraw from it. Trading continues on the same page with a 1% pool fee, divided exactly like the tax.</p>
        <h2>The tax</h2>
        <p>Every trade pays the tax the creator chose at launch, {RULES.minTaxPct}% to {RULES.maxTaxPct}% on each side, in the pair. The platform keeps {RULES.platformPct}% of it. The creator divides the other 80% four ways, once, at launch: creator, holder dividends, buyback and burn, liquidity. A share can be zero.</p>
        <h2>Getting paid</h2>
        <p>Everything a coin owes you is a credit inside the contract until you claim it: dividends, creator fees, and what a sale brings in. Claiming is one approval and pays your wallet in the pair. Nothing is ever pushed, so nobody else's wallet can block your trade.</p>
        <h2>What cannot change</h2>
        <p>Name, ticker, image, pair, tax rates and the four-way split are fixed at launch. There is no mint, no freeze, no blacklist and no pause on trading in the code. The platform can reassign a creator's fee wallet to a community lead on request, fix a picture or link, hide a coin from the list, pause new launches, add or switch off pairs for future launches, and withdraw liquidity from a graduated coin's pool.</p>
        <h2>Costs</h2>
        <p>Creating a coin costs {cfg ? Number(BigInt(cfg.launch_fee) / 10n ** 21n) / 1000 : 0.5} NEAR, plus {cfg ? Number(BigInt(cfg.coin_state_deposit) / 10n ** 21n) / 1000 : 0.5} NEAR that stays with the coin's account for its storage. Your first buy of a coin registers you on it for 0.00125 NEAR.</p>
        <h2>Contracts</h2>
        <dl className="kv">
          <dt>Network</dt><dd>{env.network}</dd>
          <dt>Factory</dt><dd style={{ wordBreak: "break-all" }}>{env.factory || "not deployed yet"}</dd>
          <dt>Coin code</dt><dd>{cfg?.current_version ? <>version {cfg.current_version.version}<span className="dim" style={{ wordBreak: "break-all" }}>hash {cfg.current_version.code_hash}</span></> : "—"}</dd>
          <dt>X</dt><dd><a className="vi" href={BRAND.x} target="_blank" rel="noreferrer">{BRAND.x.replace("https://x.com/", "@")}</a></dd>
        </dl>
        <p className="fine">Experimental software, provided as is. Tokens are created by anyone, are not vetted, and can go to zero. Nothing here is investment advice.</p>
      </div></div>
    </main>
  );
}
