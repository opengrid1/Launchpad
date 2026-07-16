import { Link, NavLink } from "react-router-dom";

import { BRAND } from "../lib/brand";
import { shortAddr } from "../lib/format";
import { useWallet } from "../lib/useWallet";

/**
 * Minimal, non-sticky top row — no header bar. Just the mark, a launch link
 * and the wallet, flowing as part of the page like the reference design.
 */
export function Header() {
  const { address, isConnected, connectFirst, disconnect, isPending } = useWallet();

  return (
    <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
      <Link to="/" className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-panel-2 ring-1 ring-inset ring-edge-2">
          <svg width="18" height="18" viewBox="0 0 64 64" fill="none" aria-hidden>
            <path d="M32 54 L32 13" stroke="#D4FC50" strokeWidth="5" strokeLinecap="round" />
            <path d="M22 22 L32 12 L42 22" stroke="#D4FC50" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M25 47 L32 41 L39 47" stroke="#D4FC50" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M25 40 L32 34 L39 40" stroke="#D4FC50" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="text-[16px] font-semibold tracking-tight text-ink">{BRAND.name}</span>
      </Link>

      <div className="flex items-center gap-4 sm:gap-5">
        <NavLink
          to="/launch"
          className={({ isActive }) =>
            `text-sm font-medium transition-colors ${isActive ? "text-ink" : "text-ink-2 hover:text-ink"}`
          }
        >
          Launch
        </NavLink>
        {isConnected && address ? (
          <button
            onClick={() => disconnect()}
            className="tnum flex h-9 items-center gap-1.5 rounded-full border border-edge-2 bg-panel px-3 text-xs font-medium text-ink transition-colors hover:border-accent hover:text-accent sm:text-sm"
            title="Disconnect"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            <span className="sm:hidden">{`${address.slice(0, 4)}..${address.slice(-3)}`}</span>
            <span className="hidden sm:inline">{shortAddr(address)}</span>
          </button>
        ) : (
          <button
            onClick={connectFirst}
            disabled={isPending}
            className="h-9 rounded-full bg-accent px-4 text-sm font-semibold text-black transition-colors hover:bg-accent-2 disabled:opacity-60"
          >
            {isPending ? "Connecting" : "Connect"}
          </button>
        )}
      </div>
    </div>
  );
}
