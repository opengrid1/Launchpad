import { Link, useLocation, useSearchParams } from "react-router-dom";

const ICONS: Record<string, JSX.Element> = {
  pools: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 20V10.5L12 5l7 5.5V20" /><rect x="8.5" y="13" width="7" height="7" rx="1" /></svg>
  ),
  trending: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3c1.5 2.5 1 4.5-.5 6C10 10.5 9 12 9 14a3 3 0 0 0 6 .2c0-1.3-.5-2.2-1-3 2 .8 3 2.6 3 4.6A6 6 0 1 1 8 11c1-1.4 1.7-2.7 1.7-4.3C11 7.5 11.7 8.5 12 10c.5-2.3.5-4.5 0-7Z" /></svg>
  ),
  movers: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15l5-5 4 3 6-7" /><path d="M19 6h-3M19 6v3" /></svg>
  ),
  top: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 4h10v4a5 5 0 0 1-10 0V4Z" /><path d="M7 5H4v1a3 3 0 0 0 3 3M17 5h3v1a3 3 0 0 1-3 3M9 20h6M12 13v4" /></svg>
  ),
  wallet: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="6" width="18" height="13" rx="3" /><path d="M3 10h18M16 14h2" /></svg>
  ),
};

const MAIN = [
  { id: "pools", to: "/", label: "Pools" },
  { id: "trending", to: "/?tab=trending", label: "Trending" },
  { id: "movers", to: "/?tab=movers", label: "Movers" },
  { id: "top", to: "/?tab=top", label: "Leaderboard" },
  { id: "wallet", to: "/profile", label: "Wallet" },
] as const;

/** koi.fun floating bottom navigation — fixed, thumb-reachable, one pink
 *  highlight on the active destination, with a separated search action. */
export function BaseBottomNav() {
  const loc = useLocation();
  const [sp] = useSearchParams();
  const tab = sp.get("tab");
  const onBoard = loc.pathname === "/";

  const isActive = (id: string) => {
    if (id === "wallet") return loc.pathname.startsWith("/profile");
    if (!onBoard) return false;
    if (id === "pools") return !tab || tab === "new";
    return tab === id;
  };

  return (
    <nav className="kf-nav" aria-label="Primary">
      <div className="kf-nav-main">
        {MAIN.map((n) => (
          <Link key={n.id} to={n.to} className={`kf-nav-btn ${isActive(n.id) ? "on" : ""}`} aria-label={n.label} aria-current={isActive(n.id) ? "page" : undefined}>
            {ICONS[n.id]}
          </Link>
        ))}
      </div>
      <div className="kf-nav-sep" />
      <Link to="/?focus=1" className="kf-nav-search" aria-label="Search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      </Link>
    </nav>
  );
}
