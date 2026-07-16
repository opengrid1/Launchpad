import { Link, NavLink } from "react-router-dom";

import { BRAND } from "../lib/brand";
import { env } from "../lib/env";
import { shortAddr } from "../lib/format";
import { useWallet } from "../lib/useWallet";

const navItems = [
  { to: "/", label: "Markets", end: true },
  { to: "/launch", label: "Launch", end: false },
  { to: "/docs", label: "Docs", end: false },
];

export function Header() {
  const { address, isConnected, connectFirst, disconnect, isPending } = useWallet();

  return (
    <header className="sticky top-0 z-40 border-b border-edge bg-bg/80 backdrop-blur-md">
      {/* hairline of accent along the very top for the terminal feel */}
      <div className="h-px w-full bg-gradient-to-r from-transparent via-accent/40 to-transparent" />
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:gap-6 sm:px-6">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-panel-2 ring-1 ring-inset ring-edge-2">
            <svg width="18" height="18" viewBox="0 0 64 64" fill="none" aria-hidden>
              <path d="M32 54 L32 13" stroke="#D4FC50" strokeWidth="5" strokeLinecap="round" />
              <path d="M22 22 L32 12 L42 22" stroke="#D4FC50" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M25 47 L32 41 L39 47" stroke="#D4FC50" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M25 40 L32 34 L39 40" stroke="#D4FC50" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="hidden text-[16px] font-semibold tracking-tight text-ink min-[380px]:block">
            {BRAND.name}
          </span>
        </Link>

        <nav className="flex items-center gap-0.5 rounded-full border border-edge bg-panel/60 p-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
                  isActive ? "bg-accent text-black" : "text-ink-2 hover:text-ink"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2.5">
          <span className="hidden items-center gap-1.5 rounded-full border border-edge bg-panel px-2.5 py-1.5 font-mono text-[11px] text-ink-2 md:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-up" />
            {env.chainName}
          </span>
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
    </header>
  );
}
