import { NavLink } from "react-router-dom";

import { Icon, type IconName } from "./Icon";

/**
 * Primary navigation — a horizontal row of icon-over-label tabs inside a
 * rounded container, active tab filled. Scrolls horizontally on small screens.
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
    <div className="mx-auto max-w-6xl px-4 pt-3 sm:px-5">
      <nav className="no-scrollbar flex gap-1 overflow-x-auto rounded-2xl border border-edge bg-panel p-1.5">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              `flex shrink-0 flex-col items-center gap-1 rounded-xl px-4 py-2 transition-colors ${
                isActive ? "bg-accent text-white" : "text-ink-2 hover:bg-panel-2 hover:text-ink"
              }`
            }
          >
            <Icon name={t.icon} size={19} />
            <span className="text-[10.5px] font-bold uppercase tracking-wide">{t.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
