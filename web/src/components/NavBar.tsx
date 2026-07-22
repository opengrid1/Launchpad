import { NavLink } from "react-router-dom";

import { Icon, type IconName } from "./Icon";

/**
 * Mobile bottom tab bar. Desktop navigation lives inline in the command bar
 * (Header); this fixed bar carries the same tabs on small screens, where a
 * bottom bar is the reachable place for primary navigation.
 */
const TABS: { to: string; end?: boolean; icon: IconName; label: string }[] = [
  { to: "/", end: true, icon: "explore", label: "Discover" },
  { to: "/launch", icon: "launch", label: "Launch" },
];

export function NavBar() {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-edge bg-bg/90 backdrop-blur-md sm:hidden">
      <nav className="mx-auto flex max-w-6xl items-stretch gap-2 px-3 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              `hud-tab flex flex-1 flex-col items-center gap-0.5 px-3 py-1.5 text-[10px] font-semibold transition-colors ${
                isActive ? "hud-tab-on text-accent-ink" : "text-ink-2 hover:text-ink"
              }`
            }
          >
            <Icon name={t.icon} size={15} />
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
