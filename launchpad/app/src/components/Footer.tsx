import type { View } from "./Header";
import { IconX, IconTelegram, IconDiscord, IconGithub } from "./Icons";

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
              <div className="word">COINWORKS</div>
              <div className="sub">B20 · BASE</div>
            </div>
          </div>
          <div className="foot-soc">
            <a href="https://x.com" target="_blank" rel="noreferrer" title="X"><IconX /></a>
            <a href="https://t.me" target="_blank" rel="noreferrer" title="Telegram"><IconTelegram /></a>
            <a href="https://discord.com" target="_blank" rel="noreferrer" title="Discord"><IconDiscord /></a>
            <a href="https://github.com/opengrid1/Launchpad" target="_blank" rel="noreferrer" title="GitHub"><IconGithub /></a>
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
    </footer>
  );
}
