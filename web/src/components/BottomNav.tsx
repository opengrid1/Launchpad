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
  ];
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-edge bg-bg/95 backdrop-blur-md sm:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto flex max-w-md">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors ${
                isActive ? "text-accent" : "text-ink-2"
              }`
            }
          >
            <Icon name={t.icon} size={20} />
            {t.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
