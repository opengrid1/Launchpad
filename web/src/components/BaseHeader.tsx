import { Link, NavLink } from "react-router-dom";

import { BRAND } from "../lib/brand";
import { BaseTicker } from "./BaseTicker";
import { useWallet } from "../lib/useWallet";

function WalletButton() {
  const { address, isConnected, connectFirst, disconnect, isPending } = useWallet();
  if (isConnected && address) {
    return (
      <button onClick={() => disconnect()} className="kf-icon-btn kf-connect on" title="Disconnect">
        <span className="kf-dot" />
        {`${address.slice(0, 4)}…${address.slice(-4)}`}
      </button>
    );
  }
  return (
    <button onClick={connectFirst} disabled={isPending} className="kf-icon-btn kf-connect">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" />
        <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
      </svg>
      {isPending ? "Connecting" : "Connect"}
    </button>
  );
}

const NAV = [
  { to: "/", end: true, label: "Tokens" },
  { to: "/party", label: "Pool party" },
  { to: "/leaderboard", label: "Leaderboard" },
  { to: "/docs", label: "How it Works" },
];

/**
 * koi.fun chrome: the marquee countdown band, then the black bar — mark +
 * wordmark left, text nav (desktop), pink launch action and wallet right.
 */
export function BaseHeader() {
  return (
    <>
      <BaseTicker />
      <header className="kf-hdr sticky top-0 z-40">
        <div className="kf-hdr-inner">
          <Link to="/" aria-label={BRAND.name} className="kf-brand">
            <svg className="kf-brand-mark" viewBox="0 0 40 40" fill="none" aria-hidden>
              <defs>
                <linearGradient id="koiMark" x1="6" y1="4" x2="34" y2="36" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#ff5fb6" /><stop offset="1" stopColor="#ff2f9c" />
                </linearGradient>
              </defs>
              <path d="M20 3c-6.5 4-9 8.7-9 14.5 0 3.4 1.6 6.2 4.2 7.9-2.9.5-5.2 2.3-6.7 5.1 3.6 4.2 8 6.5 12.8 6.5 3.4 0 6-1.9 6-5 0-2.2-1.3-3.9-3.4-4.7 4.7-1.9 7.6-6 7.6-11.3C31.5 12.8 27.4 6.7 20 3Z" fill="url(#koiMark)" />
              <circle cx="17.4" cy="15.6" r="2.5" fill="#fff" />
              <circle cx="18.1" cy="15.9" r="1.1" fill="#3a0022" />
            </svg>
            <span className="kf-brand-name">{BRAND.name}<span className="kf-tld">{BRAND.tld}</span></span>
          </Link>

          <nav className="kf-nav-links" aria-label="Primary">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? "on" : "")}>{n.label}</NavLink>
            ))}
          </nav>

          <Link to="/launch" className="kf-icon-btn kf-rocket" aria-label="Launch a token" style={{ marginLeft: "auto" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
              <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
              <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
              <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
            </svg>
            <span className="kf-rocket-label">Launch a token</span>
          </Link>

          <WalletButton />
        </div>
      </header>
    </>
  );
}
