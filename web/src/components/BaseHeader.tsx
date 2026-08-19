import { useState } from "react";
import { Link, NavLink } from "react-router-dom";

import { BRAND } from "../lib/brand";
import { env } from "../lib/env";
import { useWallet } from "../lib/useWallet";

const TABS = [
  { to: "/", end: true, label: "Board" },
  { to: "/launch", label: "Create" },
  { to: "/profile", label: "Profile" },
];

function WalletButton() {
  const { address, isConnected, connectFirst, disconnect, isPending } = useWallet();
  if (isConnected && address) {
    return (
      <button onClick={() => disconnect()} className="hlh-wallet" title="Disconnect">
        <span className="hlh-wallet-dot" />
        {`${address.slice(0, 4)}…${address.slice(-4)}`}
      </button>
    );
  }
  return (
    <button onClick={connectFirst} disabled={isPending} className="hlh-connect">
      {isPending ? "Connecting" : "Connect"}
    </button>
  );
}

/**
 * stonkpad top bar — restrained, pro-trading chrome. A quiet wordmark, plain
 * nav links, a Base indicator, and a single mint action. No gradients.
 */
export function BaseHeader() {
  const [menu, setMenu] = useState(false);
  return (
    <header className="hlh sticky top-0 z-40">
      <div className="hlh-bar">
        <Link to="/" aria-label={BRAND.name} className="hlh-mark">
          {BRAND.name}<span className="hlh-tld">{BRAND.tld}</span>
        </Link>

        <nav className="hlh-nav" aria-label="Primary">
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => (isActive ? "on" : "")}>{t.label}</NavLink>
          ))}
        </nav>

        <div className="hlh-right">
          <span className="hlh-chip"><span className="hlh-chip-dot" />{env.chainName}</span>
          <Link to="/launch" className="hlh-launch">Launch</Link>
          <WalletButton />
          <button className="hlh-burger" aria-label={menu ? "Close" : "Menu"} aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            {menu ? (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden><path d="M5 5l14 14M19 5 5 19" /></svg>
            ) : (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden><path d="M4 6h16M4 12h16M4 18h16" /></svg>
            )}
          </button>
        </div>
      </div>

      {menu && (
        <nav className="hlh-menu" aria-label="Menu" onClick={() => setMenu(false)}>
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => (isActive ? "on" : "")}>{t.label}</NavLink>
          ))}
          <Link to="/docs">Docs</Link>
        </nav>
      )}
    </header>
  );
}
