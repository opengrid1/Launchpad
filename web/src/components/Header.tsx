import { Link, NavLink } from "react-router-dom";

import { BRAND } from "../lib/brand";
import { useWallet } from "../lib/useWallet";

/**
 * Editorial masthead. A thin nameplate rule, the wordmark set in the display
 * serif on the left, two quiet centre links, and a single black wallet action.
 * No pills, no glow — it should read like the head of a publication.
 */
export function Header() {
  const { address, isConnected, connectFirst, disconnect, isPending } = useWallet();

  return (
    <header className="sticky top-0 z-40 border-b border-edge bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex h-[68px] max-w-6xl items-center px-4 sm:px-8">
        {/* Brand */}
        <Link to="/" aria-label={BRAND.name} className="flex shrink-0 items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-ink">
            <svg width="15" height="15" viewBox="0 0 64 64" fill="none" aria-hidden>
              <path d="M32 51 L32 15" stroke="#b6ff00" strokeWidth="6" strokeLinecap="round" />
              <path d="M22 25 L32 15 L42 25" stroke="#b6ff00" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M25 43 L32 37 L39 43" stroke="#ffffff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="font-display text-[22px] leading-none text-ink">{BRAND.name}</span>
        </Link>

        {/* Centre nav */}
        <nav className="mx-auto hidden items-center gap-8 sm:flex">
          <Tab to="/" end>Explore</Tab>
          <Tab to="/launch">Launch</Tab>
        </nav>

        {/* Wallet */}
        <div className="ml-auto sm:ml-0">
          {isConnected && address ? (
            <button
              onClick={() => disconnect()}
              className="flex items-center gap-2 rounded-full border border-ink/15 bg-panel px-4 py-2 text-[13.5px] font-medium text-ink transition-colors hover:border-ink/30"
              title="Disconnect"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              {`${address.slice(0, 5)}…${address.slice(-4)}`}
            </button>
          ) : (
            <button
              onClick={connectFirst}
              disabled={isPending}
              className="rounded-full bg-ink px-5 py-2.5 text-[13.5px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {isPending ? "Connecting…" : "Connect wallet"}
            </button>
          )}
        </div>
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
        `relative py-1 text-[15px] transition-colors ${
          isActive ? "text-ink" : "text-ink-2 hover:text-ink"
        }`
      }
    >
      {({ isActive }) => (
        <>
          {children}
          {isActive ? (
            <span className="absolute inset-x-0 -bottom-0.5 mx-auto h-[2px] w-full bg-accent" />
          ) : null}
        </>
      )}
    </NavLink>
  );
}
