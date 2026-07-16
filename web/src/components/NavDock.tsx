import { NavLink } from "react-router-dom";

import { Icon, type IconName } from "./Icon";

/**
 * The Quiverpad nav dock — a floating pill that hovers over the page, thumb
 * reachable. Each item pairs a custom Quiverpad icon with its label; the
 * active section fills with a lime capsule and its icon lifts. Not a bar, not
 * a menu: the navigation is a single object that belongs to this product.
 */
const items: { to: string; label: string; end: boolean; icon: IconName }[] = [
  { to: "/", label: "Explore", end: true, icon: "explore" },
  { to: "/launch", label: "Launch", end: false, icon: "launch" },
  { to: "/docs", label: "Docs", end: false, icon: "docs" },
];

export function NavDock() {
  return (
    <nav
      className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Primary"
    >
      <div className="flex items-center gap-1 rounded-full border border-edge bg-panel/80 p-1.5 shadow-[0_8px_40px_-8px_rgba(17,17,17,0.28)] backdrop-blur-xl">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `group flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition-colors duration-200 ${
                isActive ? "bg-accent text-black" : "text-ink-2 hover:bg-panel-2 hover:text-ink"
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  name={item.icon}
                  size={19}
                  className={`transition-transform duration-150 ease-out ${
                    isActive ? "scale-110" : "scale-100 group-hover:scale-105"
                  }`}
                />
                <span>{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
