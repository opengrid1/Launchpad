import { NavLink } from "react-router-dom";

import { Icon, type IconName } from "./Icon";

/**
 * Minimal primary nav — a quiet row of underline tabs, small icon + label,
 * active in the accent. No boxes. Scrolls horizontally on small screens.
 */
const TABS: { to: string; end?: boolean; icon: IconName; label: string }[] = [
  { to: "/", end: true, icon: "explore", label: "Discover" },
  { to: "/launch", icon: "launch", label: "Launch" },
  { to: "/mine", icon: "wallet", label: "My Coins" },
  { to: "/rewards", icon: "favorite", label: "My Rewards" },
  { to: "/docs", icon: "docs", label: "Docs" },
];

export function NavBar() {
  return (
    <div className="border-b border-edge">
      <div className="mx-auto max-w-6xl px-4 sm:px-5">
        <nav className="no-scrollbar -mb-px flex gap-5 overflow-x-auto">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                `flex shrink-0 items-center gap-1.5 border-b-2 py-2.5 text-[12.5px] font-medium transition-colors ${
                  isActive ? "border-accent text-accent" : "border-transparent text-ink-2 hover:text-ink"
                }`
              }
            >
              <Icon name={t.icon} size={14} />
              {t.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
