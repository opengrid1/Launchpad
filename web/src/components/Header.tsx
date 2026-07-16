import { useState } from "react";
import { Link, NavLink } from "react-router-dom";

import { BRAND } from "../lib/brand";
import { useWallet } from "../lib/useWallet";

/**
 * Top bar mirroring Stackr's structure — wordmark left, a Connect action and a
 * menu on the right; inline links on desktop, a dropdown on mobile — on cream.
 */
export function Header() {
  const { address, isConnected, connectFirst, disconnect, isPending } = useWallet();
  const [menu, setMenu] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-edge bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        {/* Brand */}
        <Link to="/" aria-label={BRAND.name} className="shrink-0">
          <span className="text-[20px] font-extrabold uppercase tracking-tight text-ink">{BRAND.name}</span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-7 sm:flex">
          <Tab to="/" end>Discover</Tab>
          <Tab to="/launch">Launch</Tab>
        </nav>

        {/* Right actions */}
        <div className="flex items-center gap-2">
          {isConnected && address ? (
            <button
              onClick={() => disconnect()}
              className="flex items-center gap-2 rounded-full border border-ink/15 bg-panel px-4 py-2 text-[13.5px] font-medium text-ink transition-colors hover:border-ink/30"
              title="Disconnect"
            >
              <span className="dot-live h-1.5 w-1.5 rounded-full bg-up" />
              {`${address.slice(0, 5)}…${address.slice(-4)}`}
            </button>
          ) : (
            <button
              onClick={connectFirst}
              disabled={isPending}
              className="rounded-xl bg-accent px-5 py-2.5 text-[13.5px] font-semibold text-white transition-colors hover:bg-accent-2 disabled:opacity-60"
            >
              {isPending ? "Connecting…" : "Connect"}
            </button>
          )}

          {/* Mobile menu toggle */}
          <button
            onClick={() => setMenu((v) => !v)}
            aria-label="Menu"
            className="grid h-10 w-10 place-items-center rounded-full text-ink transition-colors hover:bg-panel-2 sm:hidden"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d={menu ? "M6 6l12 12M18 6L6 18" : "M4 7h16M4 12h16M4 17h16"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {menu ? (
        <nav className="border-t border-edge bg-bg px-4 py-2 sm:hidden">
          <MobileLink to="/" end onClick={() => setMenu(false)}>Discover</MobileLink>
          <MobileLink to="/launch" onClick={() => setMenu(false)}>Launch</MobileLink>
        </nav>
      ) : null}
    </header>
  );
}

function Tab({ to, end, children }: { to: string; end?: boolean; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `relative py-1 text-[14.5px] font-medium transition-colors ${isActive ? "text-ink" : "text-ink-2 hover:text-ink"}`
      }
    >
      {({ isActive }) => (
        <>
          {children}
          {isActive ? <span className="absolute inset-x-0 -bottom-0.5 h-[2px] w-full rounded-full bg-accent" /> : null}
        </>
      )}
    </NavLink>
  );
}

function MobileLink({ to, end, onClick, children }: { to: string; end?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) =>
        `block rounded-lg px-3 py-2.5 text-[15px] font-medium transition-colors ${isActive ? "bg-panel-2 text-ink" : "text-ink-2"}`
      }
    >
      {children}
    </NavLink>
  );
}
