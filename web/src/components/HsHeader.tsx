import { lazy, Suspense, useEffect, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";

import { BRAND } from "../lib/brand";
import { BRAND_MARK } from "../lib/hyper/defaultLogo";
import { KoiIcon } from "./base/KoiIcon";
import { WalletSheet } from "./base/WalletSheet";
import { Skeleton } from "./ui";
import { useWallet } from "../lib/useWallet";
import { useUi } from "../store";

const LaunchForm = lazy(() => import("../pages/LaunchHyper").then((m) => ({ default: m.LaunchHyper })));

const NAV = [
  { to: "/", end: true, label: "Markets" },
  { to: "/feed", label: "Feed" },
  { to: "/rewards", label: "Rewards" },
  { to: "/leaderboard", label: "Leaderboard" },
  { to: "/profile", label: "Portfolio" },
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
 * hyperstock chrome: a slim terminal-style top bar. Mark + wordmark left,
 * text navigation center (desktop), search, launch action and wallet right.
 * The launch form opens as a sheet on mobile and routes to /launch on desktop.
 */
function UtcClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const p = (n: number) => String(n).padStart(2, "0");
  return <span className="hs-clock">{p(now.getUTCHours())}:{p(now.getUTCMinutes())}:{p(now.getUTCSeconds())} UTC</span>;
}

export function HsHeader() {
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
    <>
      <header className="hs-hdr">
        <div className="hs-hdr-in">
          <Link to="/" aria-label={BRAND.name} className="hs-brand">
            <img src={BRAND_MARK} alt="" aria-hidden />
            <span>hyper<b>stock</b></span>
          </Link>

          <nav className="hs-nav" aria-label="Primary">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? "on" : "")}>{n.label}</NavLink>
            ))}
          </nav>

          <div className="hs-hdr-right">
            <UtcClock />
            <Link to="/search" className="hs-iconbtn" aria-label="Search">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            </Link>
            <button onClick={openLaunch} className="hs-launch" aria-haspopup="dialog">
              <KoiIcon name="rocket" size={15} />
              <span>Launch</span>
            </button>
            <WalletButton />
          </div>
        </div>
      </header>

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
    </>
  );
}
