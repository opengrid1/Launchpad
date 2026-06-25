import { useEffect, useRef, useState } from "react";

const SECTIONS: { id: string; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "quickstart", label: "Quickstart" },
  { id: "launch", label: "How a launch works" },
  { id: "liquidity", label: "Liquidity" },
  { id: "create", label: "Creating a token" },
  { id: "trade", label: "Trading" },
  { id: "b20", label: "B20 standard" },
  { id: "compliance", label: "Compliance" },
  { id: "fees", label: "Fees" },
  { id: "faq", label: "FAQ" },
  { id: "risks", label: "Risks" },
];

export function Docs({ anchor }: { anchor?: string }) {
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
      <div className="idx">DOCUMENTATION</div>
      <h1 className="doc-h1">Coinworks docs</h1>
      <p className="doc-sub">How instant token launches work on Base, end to end.</p>

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
              Coinworks is a token launchpad on <strong>Base</strong>. Anyone can create a native{" "}
              <strong>B20</strong> token that goes live in a single transaction. Each token launches straight
              into a <strong>Uniswap v4</strong> pool at a fixed <strong>$15,000 starting market cap</strong>,
              so every launch begins on the same footing and trades on the open market from its first block.
            </p>
            <p>The platform is built around two actions: <strong>create</strong> and <strong>trade</strong> (buy and sell).</p>
            <div className="callout">Reference implementation. Unaudited. Nothing here is financial advice.</div>
          </section>

          <section className="doc-section" id="quickstart">
            <h2>Quickstart</h2>
            <ul>
              <li><strong>Trade:</strong> open any token, connect a wallet, enter an amount, and Buy or Sell. It settles instantly on the token's Uniswap v4 pool.</li>
              <li><strong>Create:</strong> go to <code>Create</code>, fill in the token, listing (logo + socials) and launch settings, then submit one transaction.</li>
              <li><strong>Track:</strong> watch a token's market cap on the Explore grid.</li>
            </ul>
          </section>

          <section className="doc-section" id="launch">
            <h2>How a launch works</h2>
            <p>
              Creating a token issues a native B20 and opens a <strong>Uniswap v4</strong> pool for it against
              ETH. Liquidity is added <strong>single-sided</strong> (the token only), placed so the token starts
              at a <strong>$15,000 market cap</strong>. The starting price is derived from a{" "}
              <strong>Chainlink ETH/USD oracle</strong>, so the $15k is in real dollars regardless of the ETH
              price at launch. From there the price is discovered by the market: buys push it up, sells push it
              down, against the pool.
            </p>
            <ul>
              <li>Every token starts at a <strong>$15,000 market cap</strong>, priced in USD via a Chainlink oracle.</li>
              <li>Single-sided: the pool is seeded with the token, and ETH enters as people buy.</li>
              <li>Tradable instantly on Uniswap v4 from the first block, no waiting.</li>
            </ul>
          </section>

          <section className="doc-section" id="liquidity">
            <h2>Liquidity</h2>
            <p>
              The launch seeds a single-sided liquidity position into the token's Uniswap v4 pool. That position
              is held by the launch contract and <strong>managed by the project</strong>: the project can collect
              the pool's trading fees and can withdraw the liquidity.
            </p>
          </section>

          <section className="doc-section" id="create">
            <h2>Creating a token</h2>
            <p>Creation is a single transaction with three groups of settings:</p>
            <ul>
              <li><strong>Token:</strong> name, symbol, decimals, and variant. B20 has two variants: <strong>Asset</strong> (general tokens, 6-18 decimals) and <strong>Stablecoin</strong> (fiat-pegged, 6 decimals, ISO currency code).</li>
              <li><strong>Listing:</strong> logo, description and links (Website / X / Telegram / Discord). These are pinned to IPFS and written into the token's ERC-7572 <code>contractURI</code>.</li>
              <li><strong>Launch:</strong> every token opens at a fixed <strong>$15,000 market cap</strong> on a Uniswap v4 pool, with an optional initial dev buy in the same transaction.</li>
            </ul>
            <p>Advanced B20 controls (roles, supply cap, pause policy and compliance) are configured in the same flow (see below).</p>
          </section>

          <section className="doc-section" id="trade">
            <h2>Trading: buy &amp; sell</h2>
            <p>
              Open a token and use the <strong>Trade</strong> panel. Switch between <strong>Buy</strong> (pay
              ETH, receive tokens) and <strong>Sell</strong> (sell tokens, receive ETH). Trades route to the
              token's <strong>Uniswap v4</strong> pool and settle instantly. The panel shows the amount you will
              receive and the price impact before you confirm.
            </p>
          </section>

          <section className="doc-section" id="b20">
            <h2>The B20 standard</h2>
            <p>
              B20 is Base's native token standard, implemented in the node software as precompiles rather than
              an EVM contract. It is a superset of ERC-20, compatible with existing wallets and DEXs, and is
              cheaper and higher-throughput than contract tokens. It ships with role-based access control,
              chain-level compliance policies, an optional supply cap, granular pausing, transfer memos, and
              built-in <code>permit</code> (ERC-2612) and <code>contractURI</code> (ERC-7572). Every B20 address
              starts with <code>0xB200</code>.
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
              <li><strong>Trading fee:</strong> a small fee on each swap in the token's pool. <strong>70%</strong> of platform fees are paid to <code>$WORK</code> holders in ETH.</li>
              <li><strong>Creation:</strong> only Base gas. Issuing a B20 has no contract deployment cost.</li>
            </ul>
            <p className="muted small">Exact rates are set per deployment and shown in the app before you confirm.</p>
          </section>

          <section className="doc-section" id="faq">
            <h2>FAQ</h2>
            <p><strong>Can I sell right after a token launches?</strong> Yes. Buying and selling are live from the first block.</p>
            <p><strong>What does a token start at?</strong> Every token opens at a $15,000 market cap on its Uniswap v4 pool, priced in USD via a Chainlink oracle.</p>
            <p><strong>What is the token logo stored as?</strong> It is pinned to IPFS and referenced by the token's ERC-7572 <code>contractURI</code>.</p>
          </section>

          <section className="doc-section" id="risks">
            <h2>Risks &amp; disclaimer</h2>
            <p>
              Token launches are high-risk. Prices are volatile, most tokens go to zero, and this is a
              reference implementation that is <strong>unaudited</strong>. Never spend more than you can
              afford to lose, verify every token yourself, and understand your local regulations. Coinworks
              is provided as-is with no warranty.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
