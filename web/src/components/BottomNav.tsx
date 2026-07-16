import { NavLink } from "react-router-dom";

import { Icon, type IconName } from "./Icon";

/**
 * Mobile bottom tab bar — the primary navigation on small screens (replaces a
 * hamburger). Fixed to the bottom, hidden from sm up where the header nav
 * takes over.
 */
export function BottomNav() {
  const tabs: { to: string; end?: boolean; icon: IconName; label: string }[] = [
    { to: "/", end: true, icon: "explore", label: "Discover" },
    { to: "/launch", icon: "launch", label: "Launch" },
    { to: "/mine", icon: "wallet", label: "My Coins" },
  ];
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 sm:hidden"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 14px)" }}
    >
      <nav className="pointer-events-auto flex items-center gap-1 rounded-full border border-edge bg-panel/90 p-1 shadow-[0_8px_30px_-8px_rgba(0,0,0,0.7)] backdrop-blur-xl">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              `flex items-center gap-1.5 rounded-full px-4 py-2 text-[12.5px] font-semibold transition-colors ${
                isActive ? "bg-accent text-white" : "text-ink-2 hover:text-ink"
              }`
            }
          >
            <Icon name={t.icon} size={17} />
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
