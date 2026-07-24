import { NavLink, Link } from "react-router-dom";

import { BRAND } from "../lib/brand";
import { env } from "../lib/env";
import { useWallet } from "../lib/useWallet";
import { Icon, type IconName } from "./Icon";

const TABS: { to: string; end?: boolean; icon: IconName; label: string }[] = [
  { to: "/", end: true, icon: "explore", label: "Discover" },
  { to: "/launch", icon: "launch", label: "Launch" },
];

/**
 * Top bar — live wordmark left, HUD nav tabs inline on desktop, chain
 * indicator + Connect on the right. On mobile the tabs repeat in a fixed
 * bottom bar, thumb reachable.
 */
export function Header() {
  const { address, isConnected, connectFirst, disconnect, isPending } = useWallet();

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-edge bg-bg/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-5">
          {/* Brand */}
          <Link to="/" aria-label={BRAND.name} className="flex shrink-0 items-center gap-2">
            <span className="dot-live h-2 w-2 rounded-full bg-up shadow-[0_0_8px_var(--color-up)]" />
            <span className="text-[15px] font-extrabold lowercase tracking-tight text-ink">
              {BRAND.name}
              <span className="text-accent-ink">{BRAND.tld}</span>
            </span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden items-center gap-1.5 sm:flex" aria-label="Primary">
            {TABS.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.end}
                className={({ isActive }) =>
                  `hud-tab flex items-center gap-1.5 px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors ${
                    isActive ? "hud-tab-on text-accent-ink" : "text-ink-2 hover:text-ink"
                  }`
                }
              >
                <Icon name={t.icon} size={14} />
                {t.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex-1" />

          {/* Chain indicator */}
          <div className="hidden items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-3 md:flex">
            {env.chainName}
            <span aria-hidden>·</span>
            <span className="text-ion">{env.chainId}</span>
          </div>

          {/* Wallet */}
          <div className="flex shrink-0 items-center">
            {isConnected && address ? (
              <button
                onClick={() => disconnect()}
                className="hud-cut flex items-center gap-1.5 border border-edge bg-panel px-3 py-1.5 text-[12.5px] font-medium text-ink transition-colors hover:border-edge-2"
                title="Disconnect"
              >
                <span className="dot-live h-1.5 w-1.5 rounded-full bg-up" />
                {`${address.slice(0, 4)}…${address.slice(-4)}`}
              </button>
            ) : (
              <button
                onClick={connectFirst}
                disabled={isPending}
                className="hud-cut bg-accent px-4 py-1.5 text-[12.5px] font-semibold text-accent-fg transition-colors disabled:opacity-60"
              >
                {isPending ? "Connecting…" : "Connect"}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Mobile bottom tabs */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-edge bg-bg/90 backdrop-blur-md sm:hidden"
        aria-label="Primary mobile"
      >
        <div className="mx-auto flex max-w-6xl items-stretch gap-2 px-3 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                `hud-tab flex flex-1 flex-col items-center gap-0.5 px-3 py-1.5 text-[10px] font-semibold transition-colors ${
                  isActive ? "hud-tab-on text-accent-ink" : "text-ink-2 hover:text-ink"
                }`
              }
            >
              <Icon name={t.icon} size={17} />
              {t.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </>
  );
}
