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
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="6.5" width="18" height="13" rx="3" /><path d="M21 11h-4a2 2 0 0 0 0 4h4" />
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
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M18.5 5.5c-4 .4-7.2 2.1-9.5 5L6.5 13a1 1 0 0 0 0 1.4l3.1 3.1a1 1 0 0 0 1.4 0l2.5-2.5c2.9-2.3 4.6-5.5 5-9.5Z" />
              <circle cx="14.2" cy="9.8" r="1.6" />
              <path d="M8 16 4.9 19.1M6.7 14.2l-2.2.6M9.8 17.3l-.6 2.2" />
            </svg>
            <span className="kf-rocket-label">Launch a token</span>
          </Link>

          <WalletButton />
        </div>
      </header>
    </>
  );
}
