import { Link, useLocation } from "react-router-dom";

const ICONS: Record<string, JSX.Element> = {
  bars: (
    <svg viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="12" width="3.4" height="8" rx="1" /><rect x="10.3" y="6" width="3.4" height="14" rx="1" /><rect x="16.6" y="9.5" width="3.4" height="10.5" rx="1" /></svg>
  ),
  flame: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3.5C9 7.3 6.8 10 6.8 13.4a5.2 5.2 0 0 0 10.4 0C17.2 10 15 7.3 12 3.5Z" /><path d="M12 18.4a2.6 2.6 0 0 1-2.6-2.6c0-1.2 1-2.4 2.6-3.6 1.6 1.2 2.6 2.4 2.6 3.6a2.6 2.6 0 0 1-2.6 2.6Z" /></svg>
  ),
  arrow: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 16.5 9 11l3.5 3L19 7.5" /><path d="M14.5 7.5H19V12" /></svg>
  ),
  trophy: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M8 4h8v5a4 4 0 0 1-8 0V4Z" /><path d="M8 5.5H5V7a2.5 2.5 0 0 0 2.5 2.5M16 5.5h3V7a2.5 2.5 0 0 1-2.5 2.5" /><path d="M12 13v3" /><path d="M8.5 19.5h7M10 16h4v3.5h-4z" /></svg>
  ),
  wallet: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="6.5" width="18" height="13" rx="3" /><path d="M21 11h-4a2 2 0 0 0 0 4h4" /></svg>
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
