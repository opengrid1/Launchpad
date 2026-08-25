import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";

import { BRAND, IS_INK } from "../lib/brand";
import { env } from "../lib/env";
import { BRAND_MARK } from "../lib/hyper/defaultLogo";
import { KoiIcon } from "./base/KoiIcon";
import { WalletSheet } from "./base/WalletSheet";
import { BaseBottomNav } from "./BaseBottomNav";
import { Skeleton } from "./ui";
import { useWallet } from "../lib/useWallet";
import { useUi } from "../store";

const LaunchForm = lazy(() => import("../pages/LaunchHyper").then((m) => ({ default: m.LaunchHyper })));

// Wordmark halves: the accent lands on the suffix ("squid|pad", "hyper|stock").
const [MARK_A, MARK_B] = IS_INK ? ["squid", "pad"] : ["hyper", "stock"];

const NAV: { to: string; end?: boolean; label: string; icon: ReactNode }[] = [
  { to: "/", end: true, label: "Markets", icon: <KoiIcon name="bar-chart" size={17} /> },
  { to: "/feed", label: "Feed", icon: <KoiIcon name="zap" size={17} /> },
  { to: "/rewards", label: "Rewards", icon: <KoiIcon name="trophy" size={17} /> },
  { to: "/leaderboard", label: "Leaderboard", icon: <KoiIcon name="trending-up" size={17} /> },
  { to: "/profile", label: "Portfolio", icon: <KoiIcon name="wallet-alt" size={17} /> },
  { to: "/docs", label: "Docs", icon: <KoiIcon name="menu" size={17} /> },
];

function UtcClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const p = (n: number) => String(n).padStart(2, "0");
  return <span className="hs-clock">{p(now.getUTCHours())}:{p(now.getUTCMinutes())}:{p(now.getUTCSeconds())} UTC</span>;
}

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
    <div className="hs-shell">
      <aside className="hs-side">
        <Link to="/" aria-label={BRAND.name} className="hs-side-brand">
          <img src={BRAND_MARK} alt="" aria-hidden />
          <span>{MARK_A}<b>{MARK_B}</b></span>
        </Link>
        <nav className="hs-side-nav" aria-label="Primary">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? "on" : "")}>
              {n.icon}
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <button onClick={openLaunch} className="hs-side-launch" aria-haspopup="dialog">
          <KoiIcon name="rocket" size={16} />
          <span>Launch a coin</span>
        </button>
        <div className="hs-side-foot">
          <span className="hs-side-chain"><span className="hs-dot" /> {env.chainName}</span>
        </div>
      </aside>

      <div className="hs-main">
        <div className="hs-top">
          <Link to="/" className="hs-top-brand" aria-label={BRAND.name}>
            <img src={BRAND_MARK} alt="" aria-hidden />
            <span>{MARK_A}<b>{MARK_B}</b></span>
          </Link>
          <Link to="/search" className="hs-top-search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <span>Search coins</span>
          </Link>
          <div className="hs-top-right">
            <UtcClock />
            <button onClick={openLaunch} className="hs-launch" aria-haspopup="dialog">
              <KoiIcon name="rocket" size={15} />
              <span>Launch</span>
            </button>
            <WalletButton />
          </div>
        </div>
        <main className="hs-content">{children}</main>
      </div>

      {IS_INK ? (
        <nav className="hs-tabbar" aria-label="Primary">
          <NavLink to="/" end className={({ isActive }) => (isActive ? "on" : "")}><KoiIcon name="bar-chart" size={18} /><span>Markets</span></NavLink>
          <NavLink to="/feed" className={({ isActive }) => (isActive ? "on" : "")}><KoiIcon name="zap" size={18} /><span>Feed</span></NavLink>
          <button className="hs-tabbar-launch" onClick={openLaunch} aria-label="Launch"><KoiIcon name="rocket" size={19} /></button>
          <NavLink to="/rewards" className={({ isActive }) => (isActive ? "on" : "")}><KoiIcon name="trophy" size={18} /><span>Rewards</span></NavLink>
          <NavLink to="/profile" className={({ isActive }) => (isActive ? "on" : "")}><KoiIcon name="wallet-alt" size={18} /><span>Wallet</span></NavLink>
        </nav>
      ) : (
        <BaseBottomNav />
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
