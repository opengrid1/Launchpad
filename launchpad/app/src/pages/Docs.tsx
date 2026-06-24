import { useEffect, useRef, useState } from "react";

const SECTIONS: { id: string; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "quickstart", label: "Quickstart" },
  { id: "bonding", label: "Bonding curve" },
  { id: "graduation", label: "Graduation" },
  { id: "create", label: "Creating a token" },
  { id: "trade", label: "Trading" },
  { id: "b20", label: "B20 standard" },
  { id: "compliance", label: "Compliance" },
  { id: "fees", label: "Fees" },
  { id: "faq", label: "FAQ" },
  { id: "risks", label: "Risks" },
];

export function Docs({ anchor, back }: { anchor?: string; back: () => void }) {
  const [active, setActive] = useState(anchor || "overview");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (anchor) {
      const el = document.getElementById(anchor);
      if (el) el.scrollIntoView({ block: "start" });
    }
  }, [anchor]);

  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive(vis[0].target.id);
      },
      { rootMargin: "-80px 0px -70% 0px" }
    );
    ref.current?.querySelectorAll(".doc-section").forEach((s) => obs.observe(s));
    return () => obs.disconnect();
  }, []);

  function jump(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActive(id);
  }

  return (
    <div className="wrap page">
      <span className="back" onClick={back}>← Back to launchpad</span>
      <div className="idx">DOCUMENTATION</div>
      <h1 className="doc-h1">Umbra Launchpad docs</h1>
      <p className="doc-sub">How instant bonding-curve launches work on Base, end to end.</p>

      <div className="docs">
        <nav className="docs-nav">
          {SECTIONS.map((s) => (
            <button key={s.id} className={active === s.id ? "active" : ""} onClick={() => jump(s.id)}>{s.label}</button>
          ))}
        </nav>

        <div className="docs-content" ref={ref}>
          <section className="doc-section" id="overview">
            <h2>Overview</h2>
            <p>
              Umbra Launchpad is a fair-launch token platform on <strong>Base</strong>. Anyone can create a
              token that is tradable the instant it launches. No presale, no whitelist, no insider
              allocation. Every token is issued with the native <strong>B20</strong> standard and trades on a
              <strong> bonding curve</strong> until it graduates to a decentralized exchange.
            </p>
            <p>The platform is built around three actions: <strong>create</strong>, <strong>trade</strong> (buy and sell), and <strong>graduate</strong>.</p>
            <div className="callout">Reference implementation. Unaudited and testnet-only for now. Nothing here is financial advice.</div>
          </section>

          <section className="doc-section" id="quickstart">
            <h2>Quickstart</h2>
            <ul>
              <li><strong>Trade:</strong> open any token, connect a wallet, enter an amount, and Buy or Sell. It settles instantly against the curve.</li>
              <li><strong>Create:</strong> go to <code>Create</code>, fill in the token, listing (logo + socials) and launch settings, then submit one transaction.</li>
              <li><strong>Track:</strong> watch a token's market cap climb toward its graduation target on the Explore grid.</li>
            </ul>
          </section>

          <section className="doc-section" id="bonding">
            <h2>How the bonding curve works</h2>
            <p>
              A bonding curve is a smart contract that prices a token as a function of its circulating
              supply. Buying mints tokens from the curve and pushes the price <strong>up</strong>; selling
              returns tokens to the curve and pushes the price <strong>down</strong>. The curve always holds
              the ETH, so there is <strong>always liquidity</strong>. You can buy or sell at any time, with
              no order book and no counterparty.
            </p>
            <ul>
              <li>Price starts near zero and rises along the curve as more is bought.</li>
              <li>Large orders move the price more, shown as <strong>price impact</strong> before you confirm.</li>
              <li>There is no presale and no team pre-allocation; everyone trades the same curve.</li>
            </ul>
          </section>

          <section className="doc-section" id="graduation">
            <h2>Graduation</h2>
            <p>
              When a token's market cap reaches its <strong>graduation target</strong>, it automatically
              migrates from the bonding curve to a Base DEX. The accumulated ETH and a matching token amount
              are deposited as liquidity, and the <strong>LP is burned</strong> so the liquidity can never be
              pulled. After graduation the token trades on the open market at the DEX price.
            </p>
            <div className="callout">Graduated tokens are marked <strong>Graduated</strong> on Explore and trade against locked DEX liquidity instead of the curve.</div>
          </section>

          <section className="doc-section" id="create">
            <h2>Creating a token</h2>
            <p>Creation is a single transaction with three groups of settings:</p>
            <ul>
              <li><strong>Token:</strong> name, symbol, decimals, and variant. B20 has two variants: <strong>Asset</strong> (general tokens, 6-18 decimals) and <strong>Stablecoin</strong> (fiat-pegged, 6 decimals, ISO currency code).</li>
              <li><strong>Listing:</strong> logo, description and links (Website / X / Telegram / Discord). These are pinned to IPFS and written into the token's ERC-7572 <code>contractURI</code>.</li>
              <li><strong>Launch:</strong> graduation target and an optional initial dev buy that seeds the first position in the same tx.</li>
            </ul>
            <p>Advanced B20 controls (roles, supply cap, pause policy and compliance) are configured in the same flow (see below).</p>
          </section>

          <section className="doc-section" id="trade">
            <h2>Trading: buy &amp; sell</h2>
            <p>
              Open a token and use the <strong>Trade</strong> panel. Switch between <strong>Buy</strong> (pay
              ETH, receive tokens) and <strong>Sell</strong> (sell tokens, receive ETH). The panel shows the
              amount you will receive and the price impact before you confirm. Trades on a bonding token
              settle against the curve; graduated tokens settle against the DEX pool.
            </p>
          </section>

          <section className="doc-section" id="b20">
            <h2>The B20 standard</h2>
            <p>
              B20 is Base's native token standard, implemented in the node software as precompiles rather than
              an EVM contract. It is a superset of ERC-20, compatible with existing wallets and DEXs, and is
              cheaper and higher-throughput than contract tokens. It ships with role-based access control,
              chain-level compliance policies, an optional supply cap, granular pausing, transfer memos, and
              built-in <code>permit</code> (ERC-2612) and <code>contractURI</code> (ERC-7572).
            </p>
          </section>

          <section className="doc-section" id="compliance">
            <h2>Compliance</h2>
            <p>B20 puts compliance at the chain level, configurable at creation:</p>
            <ul>
              <li><strong>Roles:</strong> <code>MINT</code>, <code>BURN</code>, <code>PAUSE</code>/<code>UNPAUSE</code>, <code>METADATA</code>, plus <code>OPERATOR</code> on the Asset variant. A token can be made <strong>permanently admin-less</strong>.</li>
              <li><strong>Transfer policy:</strong> Open, Allowlist or Blocklist, bound to sender / receiver / mint-receiver scopes.</li>
              <li><strong>Freeze &amp; seize:</strong> <code>BURN_BLOCKED_ROLE</code> for regulated issuers.</li>
            </ul>
            <div className="callout">For a trustless fair launch, leave transfers Open and the token admin-less. Freeze/seize is for regulated issuers only.</div>
          </section>

          <section className="doc-section" id="fees">
            <h2>Fees</h2>
            <ul>
              <li><strong>Trading fee:</strong> a small percentage on each buy and sell on the curve.</li>
              <li><strong>Creation:</strong> only Base gas. Issuing a B20 has no contract deployment cost.</li>
              <li><strong>Graduation:</strong> a one-time fee when liquidity migrates to the DEX.</li>
            </ul>
            <p className="muted small">Exact rates are set per deployment and shown in the app before you confirm.</p>
          </section>

          <section className="doc-section" id="faq">
            <h2>FAQ</h2>
            <p><strong>Do I have to wait for a presale to sell?</strong> No. Buying and selling are instant from the moment a token launches.</p>
            <p><strong>Where does the liquidity come from?</strong> The bonding curve itself holds the ETH, so there is always a price to trade at.</p>
            <p><strong>Can the team rug the liquidity?</strong> At graduation the LP is burned, so DEX liquidity can't be pulled.</p>
            <p><strong>What is the token logo stored as?</strong> It is pinned to IPFS and referenced by the token's ERC-7572 <code>contractURI</code>.</p>
          </section>

          <section className="doc-section" id="risks">
            <h2>Risks &amp; disclaimer</h2>
            <p>
              Token launches are high-risk. Prices are volatile, most tokens go to zero, and this is a
              reference implementation that is <strong>unaudited</strong>. Never spend more than you can
              afford to lose, verify every token yourself, and understand your local regulations. Umbra
              Launchpad is provided as-is with no warranty.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
