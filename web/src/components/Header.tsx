import { Link, NavLink } from "react-router-dom";

import { BRAND } from "../lib/brand";
import { useWallet } from "../lib/useWallet";

/**
 * Terminal top bar — thin, full-bleed, monospace-forward. A brand mark and a
 * couple of route tabs on the left; a live network readout and the wallet on
 * the right. Reads like the chrome of a trading terminal, not a marketing nav.
 */
export function Header() {
  const { address, isConnected, connectFirst, disconnect, isPending } = useWallet();

  return (
    <header className="sticky top-0 z-40 border-b border-edge bg-bg/85 backdrop-blur-xl">
      <div className="flex h-12 items-center gap-1 px-3 sm:px-4">
        {/* Brand */}
        <Link to="/" aria-label="Explore" className="mr-2 flex shrink-0 items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-accent">
            <svg width="13" height="13" viewBox="0 0 64 64" fill="none" aria-hidden>
              <path d="M32 54 L32 13" stroke="#0a0b0a" strokeWidth="6" strokeLinecap="round" />
              <path d="M22 22 L32 12 L42 22" stroke="#0a0b0a" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M25 46 L32 40 L39 46" stroke="#0a0b0a" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="hidden text-[14px] font-bold tracking-tight text-ink sm:block">
            {BRAND.name}
          </span>
        </Link>

        {/* Route tabs */}
        <nav className="flex items-center">
          <Tab to="/" end>
            Markets
          </Tab>
          <Tab to="/launch">Launch</Tab>
        </nav>

        <div className="flex-1" />

        {/* Network readout */}
        <div className="mono mr-1 hidden items-center gap-1.5 rounded-md border border-edge bg-panel px-2.5 py-1 text-[11px] text-ink-2 md:flex">
          <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-up" />
          <span className="uppercase tracking-wide">Robinhood Chain</span>
        </div>

        {/* Wallet */}
        {isConnected && address ? (
          <button
            onClick={() => disconnect()}
            className="mono flex items-center gap-1.5 rounded-md border border-edge-2 bg-panel px-2.5 py-1.5 text-[12px] font-medium text-ink transition-colors hover:border-accent/50"
            title="Disconnect"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            {`${address.slice(0, 4)}…${address.slice(-4)}`}
          </button>
        ) : (
          <button
            onClick={connectFirst}
            disabled={isPending}
            className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-bold uppercase tracking-wide text-black transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {isPending ? "…" : "Connect"}
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
        `relative px-3 py-1.5 text-[13px] font-semibold transition-colors ${
          isActive ? "text-ink" : "text-ink-3 hover:text-ink-2"
        }`
      }
    >
      {({ isActive }) => (
        <>
          {children}
          {isActive ? (
            <span className="absolute inset-x-3 -bottom-[9px] h-[2px] rounded-full bg-accent" />
          ) : null}
        </>
      )}
    </NavLink>
  );
}
