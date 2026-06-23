import { ConnectButton } from "./ConnectButton";

type Tab = "presale" | "pool";

export function Header({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  return (
    <header className="nav">
      <div className="brand">
        <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
          <circle cx="8" cy="11" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="14" cy="11" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
        <span>umbra</span>
      </div>
      <nav className="tabs">
        <button className={tab === "presale" ? "active" : ""} onClick={() => setTab("presale")}>
          Presale
        </button>
        <button className={tab === "pool" ? "active" : ""} onClick={() => setTab("pool")}>
          Pool
        </button>
      </nav>
      <ConnectButton />
    </header>
  );
}
