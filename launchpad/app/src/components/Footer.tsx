import type { View } from "./Header";
import { CoinMark, IconX } from "./Icons";

export function Footer({ go }: { go: (v: View, anchor?: string) => void }) {
  return (
    <footer className="foot wrap">
      <div className="foot-cols">
        <div className="foot-brand">
          <div className="brand">
            <CoinMark className="mark" size={24} />
            <div>
              <div className="word">COINWORKS</div>
              <div className="sub">B20 · BASE</div>
            </div>
          </div>
          <div className="foot-soc">
            <a href="https://x.com/Coinworks_" target="_blank" rel="noreferrer" title="X"><IconX /></a>
          </div>
        </div>

        <div className="foot-col">
          <h4>Product</h4>
          <a onClick={() => go("explore")}>Explore</a>
          <a onClick={() => go("create")}>Create</a>
          <a onClick={() => go("presale")}>Presale</a>
          <a onClick={() => go("docs")}>Docs</a>
        </div>

        <div className="foot-col">
          <h4>Learn</h4>
          <a onClick={() => go("docs", "bonding")}>How it works</a>
          <a onClick={() => go("docs", "graduation")}>Graduation</a>
          <a onClick={() => go("docs", "b20")}>B20 standard</a>
          <a onClick={() => go("docs", "fees")}>Fees</a>
          <a onClick={() => go("docs", "faq")}>FAQ</a>
        </div>

        <div className="foot-col">
          <h4>Legal</h4>
          <a onClick={() => go("terms", "terms")}>Terms of use</a>
          <a onClick={() => go("terms", "privacy")}>Privacy</a>
          <a onClick={() => go("terms", "disclaimer")}>Disclaimer</a>
        </div>
      </div>
    </footer>
  );
}
