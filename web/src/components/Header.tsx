import { NavLink } from "react-router-dom";

import { shortAddr } from "../lib/format";
import { useWallet } from "../lib/useWallet";

const tabs = [
  { to: "/", label: "Explore", end: true },
  { to: "/docs", label: "Docs", end: false },
];

/**
 * No header bar — floating pill nav and wallet, like the reference. It flows
 * over the page ground rather than sitting in a bordered bar.
 */
export function Header() {
  const { address, isConnected, connectFirst, disconnect, isPending } = useWallet();

  return (
    <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-5 sm:px-6">
      <nav className="flex items-center gap-1 rounded-full border border-edge bg-panel p-1">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              `rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                isActive ? "bg-edge-2 text-ink" : "text-ink-2 hover:text-ink"
              }`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>

      {isConnected && address ? (
        <button
          onClick={() => disconnect()}
          className="tnum flex h-11 items-center gap-2 rounded-full bg-panel px-4 text-sm font-semibold text-ink shadow-[var(--shadow-card)] transition-colors hover:text-down"
          title="Disconnect"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-up" />
          <span className="sm:hidden">{`${address.slice(0, 4)}..${address.slice(-3)}`}</span>
          <span className="hidden sm:inline">{shortAddr(address)}</span>
        </button>
      ) : (
        <button
          onClick={connectFirst}
          disabled={isPending}
          className="h-11 rounded-full bg-accent px-6 text-sm font-bold text-black shadow-[var(--shadow-card)] transition-colors hover:bg-accent-2 disabled:opacity-60"
        >
          {isPending ? "Connecting" : "Connect"}
        </button>
      )}
    </div>
  );
}
