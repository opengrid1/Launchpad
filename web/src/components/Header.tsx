import { Link, NavLink } from "react-router-dom";

import { env } from "../lib/env";
import { shortAddr } from "../lib/format";
import { useWallet } from "../lib/useWallet";
import { Button } from "./ui";

const navItems = [
  { to: "/", label: "Markets" },
  { to: "/create", label: "Launch" },
  { to: "/dashboard", label: "Creator" },
  { to: "/admin", label: "Admin" },
];

export function Header() {
  const { address, isConnected, connectFirst, disconnect, isPending } = useWallet();

  return (
    <header className="sticky top-0 z-40 border-b border-edge bg-bg/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-sm font-bold text-white">
            M
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-ink">Meridian</span>
          <span className="mt-0.5 hidden rounded border border-edge-2 px-1.5 py-px text-[10px] font-medium uppercase tracking-wider text-ink-3 sm:block">
            {env.chainName}
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  isActive ? "bg-panel-2 text-ink" : "text-ink-2 hover:text-ink"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {isConnected && address ? (
            <button
              onClick={() => disconnect()}
              className="group flex items-center gap-2 rounded-lg border border-edge-2 px-3 py-1.5 text-sm text-ink-2 transition-colors hover:border-down/50 hover:text-down"
              title="Disconnect"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-up" />
              <span className="tnum">{shortAddr(address)}</span>
            </button>
          ) : (
            <Button onClick={connectFirst} disabled={isPending} className="py-1.5">
              {isPending ? "Connecting" : "Connect wallet"}
            </Button>
          )}
        </div>
      </div>

      <nav className="flex items-center gap-1 overflow-x-auto border-t border-edge px-3 py-1.5 md:hidden">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              `whitespace-nowrap rounded-lg px-3 py-1 text-sm font-medium ${
                isActive ? "bg-panel-2 text-ink" : "text-ink-2"
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </header>
  );
}
