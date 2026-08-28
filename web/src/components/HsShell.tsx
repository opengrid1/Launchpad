import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";

import { BRAND, IS_INK } from "../lib/brand";
import { env } from "../lib/env";
import { BRAND_MARK } from "../lib/hyper/defaultLogo";
import { KoiIcon } from "./base/KoiIcon";
import { WalletSheet } from "./base/WalletSheet";
import { Skeleton } from "./ui";
import { useWallet } from "../lib/useWallet";
import { useUi } from "../store";

const LaunchForm = lazy(() => import("../pages/LaunchHyper").then((m) => ({ default: m.LaunchHyper })));

// Wordmark halves: the accent lands on the suffix ("squid|pad", "hyper|stock").
const [MARK_A, MARK_B] = IS_INK ? ["squid", "pad"] : ["hyper", "stock"];

// Top-bar nav (desktop). The mobile tab bar mirrors the primary four.
const NAV: { to: string; end?: boolean; label: string }[] = [
  { to: "/", end: true, label: "Markets" },
  { to: IS_INK ? "/analytics" : "/feed", label: IS_INK ? "Analytics" : "Feed" },
  { to: "/rewards", label: "Rewards" },
  { to: "/leaderboard", label: "Leaderboard" },
  { to: "/profile", label: "Wallet" },
  { to: "/docs", label: "Docs" },
];

function WalletButton() {
  const { address, isConnected, connectFirst, isPending } = useWallet();
  const setWalletOpen = useUi((s) => s.setWalletOpen);
  if (isConnected && address) {
    return (
      <button onClick={() => setWalletOpen(true)} className="hs-wallet on" title="Wallet">
        <span className="hs-dot" />
        {`${address.slice(0, 4)}…${address.slice(-4)}`}
      </button>
    );
  }
  return (
    <button onClick={connectFirst} disabled={isPending} className="hs-wallet">
      {isPending ? "Connecting" : "Connect"}
    </button>
  );
}

/**
 * hyperstock app shell: fixed icon sidebar on the left (desktop), a thin top
 * bar with search, clock and wallet, and the routed page in the main pane.
 * On mobile the sidebar disappears and the floating bottom nav takes over.
 */
export function HsShell({ children }: { children: ReactNode }) {
  const nav = useNavigate();
  const loc = useLocation();
  const [sheet, setSheet] = useState(false);
  const walletOpen = useUi((s) => s.walletOpen);
  const setWalletOpen = useUi((s) => s.setWalletOpen);

  useEffect(() => { setSheet(false); }, [loc.pathname]);
  useEffect(() => {
    document.body.style.overflow = sheet ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [sheet]);

  const openLaunch = () => {
    if (window.innerWidth >= 1024) nav("/launch");
    else setSheet(true);
  };

  return (
    <div className="sqx">
      <header className="sqx-top">
        <Link to="/" className="sqx-brand" aria-label={BRAND.name}>
          <img src={BRAND_MARK} alt="" aria-hidden />
          <span>{MARK_A}<b>{MARK_B}</b></span>
        </Link>
        <nav className="sqx-nav" aria-label="Primary">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? "on" : "")}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <Link to="/search" className="sqx-search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <span>Search coins, tickers, CA</span>
        </Link>
        <button onClick={openLaunch} className="sqx-launch" aria-haspopup="dialog">
          <KoiIcon name="rocket" size={15} />
          <span>Launch</span>
        </button>
        <WalletButton />
      </header>

      <main className="sqx-content">
        {children}
        {/* Mobile-only footer: the secondary links the tab bar has no room for. */}
        <footer className="sqx-foot">
          <NavLink to="/leaderboard">Leaderboard</NavLink>
          <NavLink to="/docs">Docs</NavLink>
          <a href="https://x.com/squidpad_" target="_blank" rel="noreferrer">X</a>
          <span className="ch"><span className="hs-dot" /> {env.chainName}</span>
        </footer>
      </main>

      <nav className="sqx-tabbar" aria-label="Primary">
        <NavLink to="/" end className={({ isActive }) => (isActive ? "on" : "")}><KoiIcon name="bar-chart" size={19} /><span>Markets</span></NavLink>
        <NavLink to="/analytics" className={({ isActive }) => (isActive ? "on" : "")}><KoiIcon name="trending-up" size={19} /><span>Analytics</span></NavLink>
        <button className="sqx-fab" onClick={openLaunch} aria-label="Launch"><KoiIcon name="rocket" size={22} /></button>
        <NavLink to="/rewards" className={({ isActive }) => (isActive ? "on" : "")}><KoiIcon name="trophy" size={19} /><span>Rewards</span></NavLink>
        <NavLink to="/profile" className={({ isActive }) => (isActive ? "on" : "")}><KoiIcon name="wallet-alt" size={19} /><span>Wallet</span></NavLink>
      </nav>

      {sheet ? (
        <div className="kf-sheet-backdrop" onClick={() => setSheet(false)}>
          <div className="kf-sheet" role="dialog" aria-label="Launch a token" onClick={(e) => e.stopPropagation()}>
            <div className="kf-sheet-grip" />
            <Suspense fallback={<Skeleton className="h-64" />}>
              <LaunchForm onCancel={() => setSheet(false)} />
            </Suspense>
          </div>
        </div>
      ) : null}

      <WalletSheet open={walletOpen} onClose={() => setWalletOpen(false)} />
    </div>
  );
}
