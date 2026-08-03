import { ConnectButton } from "./ConnectButton";

type Tab = "presale" | "pool";

export function Header({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  return (
    <header className="nav">
      <div className="brand">
        <svg className="mark" width="20" height="22" viewBox="0 0 20 22" aria-hidden="true">
          <path d="M10 1.5 L18.2 6.2 L18.2 15.8 L10 20.5 L1.8 15.8 L1.8 6.2 Z" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <path d="M10 6.4 L10 15.6 M6 8.7 L14 13.3 M14 8.7 L6 13.3" stroke="currentColor" strokeWidth="0.9" opacity="0.5" />
        </svg>
        <span className="word">UMBRA</span>
      </div>
      <nav className="tabs">
        <button className={tab === "presale" ? "active" : ""} onClick={() => setTab("presale")}>
          Presale
        </button>
        <button className={tab === "pool" ? "active" : ""} onClick={() => setTab("pool")}>
          Pool
        </button>
      </nav>
      <span className="spacer" />
      <ConnectButton />
    </header>
  );
}
