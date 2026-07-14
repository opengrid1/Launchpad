import { Link, NavLink } from "react-router-dom";

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
      <div className="mx-auto flex h-16 max-w-5xl items-center gap-8 px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-ink text-[15px] font-bold text-accent">
            M
          </span>
          <span className="text-[17px] font-semibold tracking-tight text-ink">Meridian</span>
        </Link>

        <nav className="flex items-center gap-6">
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

        <div className="ml-auto">
          {isConnected && address ? (
            <button
              onClick={() => disconnect()}
              className="tnum flex h-10 items-center gap-1.5 rounded-full bg-ink px-4 text-sm font-medium text-white transition-colors hover:bg-black"
              title="Disconnect"
            >
              {shortAddr(address)}
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
