import { useEffect } from "react";

export function Terms({ anchor }: { anchor?: string }) {
  useEffect(() => {
    if (anchor) document.getElementById(anchor)?.scrollIntoView({ block: "start" });
  }, [anchor]);
  return (
    <div className="wrap page">
      <div className="idx">LEGAL</div>
      <h1 className="doc-h1">Terms &amp; disclaimer</h1>
      <p className="doc-sub">Last updated 2026. Reference implementation, testnet only.</p>

      <div className="docs-content">
        <section className="doc-section" id="terms">
          <h2>Terms of use</h2>
          <p>
            Umbra Launchpad is a non-custodial interface to smart contracts on Base. By using it you
            interact with those contracts directly from your own wallet; we never take custody of your
            funds and cannot reverse, freeze or recover transactions on your behalf. You are solely
            responsible for the tokens you create, buy, sell and hold.
          </p>
          <p>
            You agree not to use the interface where doing so is unlawful in your jurisdiction, and not to
            launch tokens that infringe rights or are designed to defraud others.
          </p>
        </section>

        <section className="doc-section" id="disclaimer">
          <h2>No financial advice</h2>
          <p>
            Nothing in this interface is investment, financial, legal or tax advice. Token launches are
            extremely high-risk and most lose all value. Do your own research and never spend more than you
            can afford to lose.
          </p>
        </section>

        <section className="doc-section" id="privacy">
          <h2>Privacy</h2>
          <p>
            The interface is a static front end. It does not run accounts or collect personal data. Wallet
            addresses and transactions are public on the Base blockchain by design. Third-party
            infrastructure you connect to (RPC providers, wallets, IPFS gateways) has its own policies.
          </p>
        </section>

        <section className="doc-section" id="warranty">
          <h2>No warranty</h2>
          <p>
            The software is unaudited and provided "as is", without warranty of any kind. To the maximum
            extent permitted by law, the authors are not liable for any loss arising from its use,
            including smart-contract bugs, market losses or loss of access to funds.
          </p>
        </section>
      </div>
    </div>
  );
}
