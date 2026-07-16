import { Link, NavLink } from "react-router-dom";

import { BRAND } from "../lib/brand";
import { shortAddr } from "../lib/format";
import { useWallet } from "../lib/useWallet";

const nav = [
  { to: "/", label: "Explore", end: true },
  { to: "/launch", label: "Launch", end: false },
  { to: "/docs", label: "Docs", end: false },
];

export function Header() {
  const { address, isConnected, connectFirst, disconnect, isPending } = useWallet();

  return (
    <header className="sticky top-0 z-40 border-b border-edge bg-bg/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:gap-6 sm:px-6">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-[12px] bg-ink">
            <svg width="19" height="19" viewBox="0 0 64 64" fill="none" aria-hidden>
              <path d="M32 54 L32 13" stroke="#B6FF00" strokeWidth="5" strokeLinecap="round" />
              <path d="M22 22 L32 12 L42 22" stroke="#B6FF00" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M25 47 L32 41 L39 47" stroke="#B6FF00" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M25 40 L32 34 L39 40" stroke="#B6FF00" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="hidden text-[17px] font-semibold tracking-tight text-ink min-[380px]:block">
            {BRAND.name}
          </span>
        </Link>

        <nav className="flex items-center gap-1">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `relative rounded-full px-3 py-2 text-sm font-medium transition-colors sm:px-3.5 ${
                  isActive ? "text-ink" : "text-ink-2 hover:text-ink"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {item.label}
                  {isActive ? (
                    <span className="absolute -bottom-[1px] left-1/2 h-[3px] w-5 -translate-x-1/2 rounded-full bg-accent" />
                  ) : null}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto shrink-0">
          {isConnected && address ? (
            <button
              onClick={() => disconnect()}
              className="tnum flex items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
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
              className="rounded-full bg-ink px-4 py-2.5 text-sm font-semibold text-white shadow-[var(--shadow-btn)] transition-opacity hover:opacity-90 disabled:opacity-60 sm:px-5"
            >
              {isPending ? "Connecting" : "Connect"}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
