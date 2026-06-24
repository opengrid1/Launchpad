import type { View } from "./Header";

export function Footer({ go }: { go: (v: View, anchor?: string) => void }) {
  return (
    <footer className="foot wrap">
      <div className="foot-cols">
        <div className="foot-brand">
          <div className="brand">
            <svg className="mark" width="18" height="20" viewBox="0 0 20 22" aria-hidden="true">
              <path d="M10 1.5 L18.2 6.2 L18.2 15.8 L10 20.5 L1.8 15.8 L1.8 6.2 Z" fill="none" stroke="currentColor" strokeWidth="1.2" />
              <path d="M10 6.4 L10 15.6 M6 8.7 L14 13.3 M14 8.7 L6 13.3" stroke="currentColor" strokeWidth="0.9" opacity="0.5" />
            </svg>
            <div>
              <div className="word">UMBRA</div>
              <div className="sub">LAUNCHPAD</div>
            </div>
          </div>
          <p className="foot-tag">Instant fair-launch tokens on Base. Buy and sell on a bonding curve the moment a token goes live.</p>
          <div className="foot-soc">
            <a href="https://x.com" target="_blank" rel="noreferrer" title="X">𝕏</a>
            <a href="https://t.me" target="_blank" rel="noreferrer" title="Telegram">✈</a>
            <a href="https://discord.com" target="_blank" rel="noreferrer" title="Discord">◎</a>
            <a href="https://github.com/opengrid1/Launchpad" target="_blank" rel="noreferrer" title="GitHub">⌥</a>
          </div>
        </div>

        <div className="foot-col">
          <h4>Product</h4>
          <a onClick={() => go("explore")}>Explore</a>
          <a onClick={() => go("create")}>Create</a>
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

      <div className="foot-bottom">
        <span>© 2026 Umbra Launchpad · B20 · Base</span>
        <span>Unaudited reference implementation · testnet only</span>
      </div>
    </footer>
  );
}
