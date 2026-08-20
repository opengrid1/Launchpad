import { Link, useLocation } from "react-router-dom";

const ICONS: Record<string, JSX.Element> = {
  bars: (
    <svg viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="12" width="3.4" height="8" rx="1" /><rect x="10.3" y="6" width="3.4" height="14" rx="1" /><rect x="16.6" y="9.5" width="3.4" height="10.5" rx="1" /></svg>
  ),
  flame: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" /></svg>
  ),
  arrow: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" /></svg>
  ),
  trophy: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" /></svg>
  ),
  wallet: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" /><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" /></svg>
  ),
};

const MAIN = [
  { id: "bars", to: "/", label: "Tokens" },
  { id: "flame", to: "/party", label: "Pool party" },
  { id: "arrow", to: "/leaderboard", label: "Leaderboard" },
  { id: "trophy", to: "/feed", label: "Feed" },
  { id: "wallet", to: "/profile", label: "Wallet" },
] as const;

/** koi.fun floating bottom navigation — fixed pill, pink active icon, with a
 *  separated search action, mirroring the reference chrome. */
export function BaseBottomNav() {
  const loc = useLocation();
  const isActive = (to: string) => (to === "/" ? loc.pathname === "/" : loc.pathname.startsWith(to));

  // The search page docks its own search bar and the token page docks the
  // Buy/Sell pair where the nav would sit, matching the reference chrome.
  if (loc.pathname.startsWith("/search") || loc.pathname.startsWith("/token/")) return null;

  return (
    <nav className="kf-nav" aria-label="Primary">
      <div className="kf-nav-main">
        {MAIN.map((n) => (
          <Link key={n.id} to={n.to} className={`kf-nav-btn ${isActive(n.to) ? "on" : ""}`} aria-label={n.label} aria-current={isActive(n.to) ? "page" : undefined}>
            {ICONS[n.id]}
          </Link>
        ))}
      </div>
      <div className="kf-nav-sep" />
      <Link to="/search" className={`kf-nav-search ${loc.pathname.startsWith("/search") ? "on" : ""}`} aria-label="Search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      </Link>
    </nav>
  );
}
