import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

/**
 * The Quiverpad nav dock — a floating pill that hovers over the page, thumb
 * reachable, with a lime capsule that marks the active section. Not a bar, not
 * a menu: the navigation is a single object that belongs to this product.
 */
const items: { to: string; label: string; end: boolean; icon: ReactNode }[] = [
  {
    to: "/",
    label: "Explore",
    end: true,
    icon: (
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
        <rect x="3" y="3" width="6" height="6" rx="2" fill="currentColor" />
        <rect x="11" y="3" width="6" height="6" rx="2" fill="currentColor" opacity="0.5" />
        <rect x="3" y="11" width="6" height="6" rx="2" fill="currentColor" opacity="0.5" />
        <rect x="11" y="11" width="6" height="6" rx="2" fill="currentColor" />
      </svg>
    ),
  },
  {
    to: "/launch",
    label: "Launch",
    end: false,
    icon: (
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
        <path d="M10 16.5V5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M5.5 9 L10 4.5 L14.5 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    to: "/docs",
    label: "Docs",
    end: false,
    icon: (
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
        <path d="M5 4h7l3 3v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        <path d="M7.5 10.5h5M7.5 13h3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    ),
  },
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
              `group flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                isActive
                  ? "bg-accent text-black shadow-[var(--shadow-btn)]"
                  : "text-ink-2 hover:bg-panel-2 hover:text-ink"
              }`
            }
          >
            {({ isActive }) => (
              <>
                {item.icon}
                <span
                  className={`overflow-hidden whitespace-nowrap transition-all duration-300 ${
                    isActive ? "max-w-[80px] opacity-100" : "max-w-0 opacity-0 group-hover:max-w-[80px] group-hover:opacity-100"
                  }`}
                >
                  {item.label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
