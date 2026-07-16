import { Link, NavLink } from "react-router-dom";

import { BRAND } from "../lib/brand";
import { useWallet } from "../lib/useWallet";

/**
 * Premium top bar — airy and centered, not a dense chrome strip. A soft brand
 * wordmark on the left, two quiet route links, and a rounded green wallet
 * action on the right. Reads as a polished fintech product.
 */
export function Header() {
  const { address, isConnected, connectFirst, disconnect, isPending } = useWallet();

  return (
    <header className="sticky top-0 z-40 border-b border-edge/70 bg-bg/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 sm:px-6">
        {/* Brand */}
        <Link to="/" aria-label={BRAND.name} className="mr-3 flex shrink-0 items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-[13px] bg-accent shadow-[0_4px_14px_-4px_rgba(0,200,5,0.5)]">
            <svg width="18" height="18" viewBox="0 0 64 64" fill="none" aria-hidden>
              <path d="M32 52 L32 14" stroke="#ffffff" strokeWidth="6" strokeLinecap="round" />
              <path d="M22 24 L32 14 L42 24" stroke="#ffffff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M25 44 L32 38 L39 44" stroke="#ffffff" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="text-[19px] font-bold tracking-tight text-ink">{BRAND.name}</span>
        </Link>

        {/* Route links */}
        <nav className="hidden items-center gap-1 sm:flex">
          <Tab to="/" end>Explore</Tab>
          <Tab to="/launch">Launch</Tab>
        </nav>

        <div className="flex-1" />

        {/* Wallet */}
        {isConnected && address ? (
          <button
            onClick={() => disconnect()}
            className="flex items-center gap-2 rounded-full border border-edge bg-panel px-4 py-2 text-[14px] font-semibold text-ink shadow-[var(--shadow-btn)] transition-colors hover:border-edge-2"
            title="Disconnect"
          >
            <span className="h-2 w-2 rounded-full bg-accent" />
            {`${address.slice(0, 5)}…${address.slice(-4)}`}
          </button>
        ) : (
          <button
            onClick={connectFirst}
            disabled={isPending}
            className="rounded-full bg-accent px-5 py-2.5 text-[14px] font-bold text-white shadow-[0_6px_18px_-6px_rgba(0,200,5,0.55)] transition-all hover:scale-[1.02] hover:bg-accent-2 disabled:opacity-60"
          >
            {isPending ? "Connecting…" : "Connect"}
          </button>
        )}
      </div>
    </header>
  );
}

function Tab({ to, end, children }: { to: string; end?: boolean; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `rounded-full px-4 py-2 text-[15px] font-semibold transition-colors ${
          isActive ? "bg-panel-2 text-ink" : "text-ink-2 hover:text-ink"
        }`
      }
    >
      {children}
    </NavLink>
  );
}
