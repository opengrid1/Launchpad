import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";

import { BRAND, BRAND_FLAVOR, IS_INK } from "../lib/brand";
import { BRAND_MARK } from "../lib/hyper/defaultLogo";
import { KoiIcon } from "./base/KoiIcon";
import { WalletSheet } from "./base/WalletSheet";
import { Skeleton } from "./ui";
import { useWallet } from "../lib/useWallet";
import { useUi } from "../store";

const LaunchForm = lazy(() => import("../pages/LaunchHyper").then((m) => ({ default: m.LaunchHyper })));

// Wordmark halves: the accent lands on the suffix ("squid|pad", "meow|stock").
const [MARK_A, MARK_B] =
  BRAND_FLAVOR === "meow" ? ["meow", "stock"] : IS_INK ? ["squid", "pad"] : ["hyper", "stock"];

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
      <KoiIcon name="wallet" size={16} />
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

  // The trading page is a focused view: it docks its own Buy/Sell bar, so the
  // shell drops the search field and the bottom tab bar there (matching the
  // reference), leaving just the brand + wallet on top.
  const onToken = loc.pathname.startsWith("/token/");

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
        {onToken ? null : (
          <Link to="/search" className="sqx-search">
            <KoiIcon name="search" size={15} />
            <span>Search coins, tickers, CA</span>
          </Link>
        )}
        <button onClick={openLaunch} className="sqx-launch" aria-haspopup="dialog">
          <KoiIcon name="rocket" size={15} />
          <span>Launch</span>
        </button>
        <WalletButton />
      </header>

      <main className={`sqx-content${onToken ? " sqx-content-token" : ""}`}>{children}</main>

      {onToken ? null : (
        <nav className="sqx-tabbar" aria-label="Primary">
          <NavLink to="/" end className={({ isActive }) => (isActive ? "on" : "")}><KoiIcon name="bar-chart" size={20} /><span>Markets</span></NavLink>
          <NavLink to="/analytics" className={({ isActive }) => (isActive ? "on" : "")}><KoiIcon name="trending-up" size={20} /><span>Analytics</span></NavLink>
          <button className="sqx-fab" onClick={openLaunch} aria-label="Launch"><KoiIcon name="rocket" size={22} /></button>
          <NavLink to="/rewards" className={({ isActive }) => (isActive ? "on" : "")}><KoiIcon name="trophy" size={20} /><span>Rewards</span></NavLink>
          <NavLink to="/profile" className={({ isActive }) => (isActive ? "on" : "")}><KoiIcon name="wallet" size={20} /><span>Wallet</span></NavLink>
        </nav>
      )}

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
