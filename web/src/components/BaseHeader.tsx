import { useState } from "react";
import { Link, NavLink } from "react-router-dom";

import { BRAND } from "../lib/brand";
import { env } from "../lib/env";
import { useWallet } from "../lib/useWallet";
import { ThemeToggle } from "./market/ThemeToggle";

const TABS = [
  { to: "/", end: true, label: "Board" },
  { to: "/launch", label: "Create" },
  { to: "/profile", label: "Profile" },
];

function WalletButton() {
  const { address, isConnected, connectFirst, disconnect, isPending } = useWallet();
  if (isConnected && address) {
    return (
      <button onClick={() => disconnect()} className="dvh-wallet" title="Disconnect">
        <span className="dvh-wallet-dot" />
        {`${address.slice(0, 4)}…${address.slice(-4)}`}
      </button>
    );
  }
  return (
    <button onClick={connectFirst} disabled={isPending} className="dvh-connect">
      {isPending ? "Connecting…" : "Connect"}
    </button>
  );
}

/**
 * stonkpad's own top bar — a rounded, gradient-accented header that matches the
 * dividend-cards identity (not the heist board's neo-brutalist chrome). A coin
 * wordmark, pill nav, the Base chip, and a gradient Launch action.
 */
export function BaseHeader() {
  const [menu, setMenu] = useState(false);
  return (
    <header className="dvh sticky top-0 z-40">
      <div className="dvh-bar">
        <Link to="/" aria-label={BRAND.name} className="dvh-mark">
          <span className="dvh-coin" aria-hidden>◎</span>
          <span className="dvh-word">{BRAND.name}<span className="dvh-tld">{BRAND.tld}</span></span>
        </Link>

        <nav className="dvh-nav" aria-label="Primary">
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `dvh-link ${isActive ? "on" : ""}`}>
              {t.label}
            </NavLink>
          ))}
        </nav>

        <div className="dvh-spacer" />

        <span className="dvh-chip"><span className="dvh-chip-dot" /> {env.chainName}</span>
        <ThemeToggle />
        <Link to="/launch" className="dvh-launch">Launch</Link>
        <WalletButton />

        <button className="dvh-burger" aria-label={menu ? "Close menu" : "Menu"} aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
          {menu ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden><path d="M5 5l14 14M19 5 5 19" /></svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          )}
        </button>
      </div>

      {menu && (
        <nav className="dvh-menu" aria-label="Menu" onClick={() => setMenu(false)}>
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `dvh-menu-link ${isActive ? "on" : ""}`}>{t.label}</NavLink>
          ))}
          <Link to="/docs" className="dvh-menu-link">Docs</Link>
        </nav>
      )}
    </header>
  );
}
