import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { Logo } from "./Logo";
import { Icon } from "./Icon";
import { ChainSelector, WalletButton } from "./wallet";

const LINKS = [
  { to: "/dashboard", label: "Dashboard", icon: "home" },
  { to: "/markets", label: "Markets", icon: "grid" },
  { to: "/activity", label: "Activity", icon: "clock" },
  { to: "/settings", label: "Settings", icon: "settings" },
];

export function NavBar() {
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();
  const onLanding = location.pathname === "/";

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      <header className={`nav${scrolled || !onLanding ? " scrolled" : ""}`}>
        <div className="container row between" style={{ gap: 16 }}>
          <Link to="/" aria-label="Meridian home">
            <Logo />
          </Link>
          <nav className="nav-links" aria-label="Primary">
            {LINKS.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
              >
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="row gap-2">
            <ChainSelector />
            <WalletButton />
          </div>
        </div>
      </header>

      <nav className="mobile-tabs" aria-label="Primary mobile">
        {LINKS.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            className={({ isActive }) => `mobile-tab${isActive ? " active" : ""}`}
          >
            <Icon name={l.icon} size={19} />
            {l.label}
          </NavLink>
        ))}
      </nav>
    </>
  );
}
