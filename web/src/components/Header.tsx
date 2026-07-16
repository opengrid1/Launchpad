import { Link, NavLink } from "react-router-dom";

import { BRAND } from "../lib/brand";
import { shortAddr } from "../lib/format";
import { useWallet } from "../lib/useWallet";

const navItems = [
  { to: "/", label: "Explore" },
  { to: "/launch", label: "Launch" },
];

export function Header() {
  const { address, isConnected, connectFirst, disconnect, isPending } = useWallet();

  return (
    <header className="sticky top-0 z-40 border-b border-edge bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-5xl items-center gap-4 px-4 sm:gap-8 sm:px-6">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-ink">
            <svg width="18" height="18" viewBox="0 0 64 64" fill="none" aria-hidden>
              <path d="M32 54 L32 13" stroke="#B6FF00" strokeWidth="5" strokeLinecap="round" />
              <path d="M22 22 L32 12 L42 22" stroke="#B6FF00" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M25 47 L32 41 L39 47" stroke="#B6FF00" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M25 40 L32 34 L39 40" stroke="#B6FF00" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="hidden text-[17px] font-semibold tracking-tight text-ink min-[400px]:block">{BRAND.name}</span>
        </Link>

        <nav className="flex items-center gap-4 sm:gap-6">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `relative py-1 text-sm font-medium transition-colors ${
                  isActive ? "text-ink" : "text-ink-2 hover:text-ink"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {item.label}
                  {isActive ? (
                    <span className="absolute -bottom-[3px] left-0 right-0 mx-auto h-[3px] w-5 rounded-full bg-accent" />
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
              className="tnum flex h-9 items-center gap-1.5 rounded-full bg-ink px-3 text-xs font-medium text-white transition-colors hover:bg-black sm:h-10 sm:px-4 sm:text-sm"
              title="Disconnect"
            >
              <span className="sm:hidden">{`${address.slice(0, 4)}...${address.slice(-4)}`}</span>
              <span className="hidden sm:inline">{shortAddr(address)}</span>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ) : (
            <button
              onClick={connectFirst}
              disabled={isPending}
              className="h-10 rounded-full bg-ink px-4 text-sm font-medium text-white transition-colors hover:bg-black disabled:opacity-60"
            >
              {isPending ? "Connecting" : "Connect"}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
