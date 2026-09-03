import { useEffect } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { useAccount } from "wagmi";

import { BRAND, env, ADDRESSES } from "./lib/env";
import { useToast } from "./lib/hooks";
import { openWalletModal } from "./lib/wallet";
import { short } from "./lib/format";
import Home from "./pages/Home";
import TokenPage from "./pages/Token";
import Launch from "./pages/Launch";
import Me from "./pages/Me";
import Docs from "./pages/Docs";

function useTheme() {
  useEffect(() => {
    try {
      const t = localStorage.getItem("theme");
      if (t) document.documentElement.dataset.theme = t;
    } catch {}
  }, []);
  return () => {
    const cur = document.documentElement.dataset.theme;
    const dark = cur ? cur === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch {}
  };
}

export default function App() {
  const { address, isConnected } = useAccount();
  const toggle = useTheme();
  const toast = useToast();
  const loc = useLocation();
  useEffect(() => { window.scrollTo({ top: 0 }); }, [loc.pathname]);

  return (
    <>
      <header className="nav">
        <div className="nav-in">
          <Link to="/" className="logo"><img src="/icon.svg" alt="" />{BRAND.name}</Link>
          <nav className="nav-links">
            <NavLink to="/" end className={({ isActive }) => (isActive ? "on" : "")}>Coins</NavLink>
            <NavLink to="/launch" className={({ isActive }) => (isActive ? "on" : "")}>Launch</NavLink>
            <NavLink to="/me" className={({ isActive }) => (isActive ? "on" : "")}>You</NavLink>
            <NavLink to="/docs" className={({ isActive }) => (isActive ? "on" : "")}>How it works</NavLink>
          </nav>
          <div className="nav-r">
            <button className="iconbtn" onClick={toggle} aria-label="Toggle appearance" title="Appearance">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 3a9 9 0 0 0 0 18V3Z" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="9" /></svg>
            </button>
            <Link to="/launch" className="pillbtn quiet" style={{ textDecoration: "none" }}>Launch</Link>
            <button className="pillbtn" onClick={() => openWalletModal()}>
              {isConnected && address ? <><span className="dot" />{short(address)}</> : "Connect"}
            </button>
          </div>
        </div>
      </header>

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/t/:address" element={<TokenPage />} />
        <Route path="/launch" element={<Launch />} />
        <Route path="/me" element={<Me />} />
        <Route path="/docs" element={<Docs />} />
        <Route path="*" element={<Home />} />
      </Routes>

      <footer className="foot">
        <span>{BRAND.name} · {env.chainName}</span>
        <span>
          <a href={`${env.explorerUrl}/address/${ADDRESSES.factory}`} target="_blank" rel="noreferrer">Factory</a>
          {" · "}<Link to="/docs">How it works</Link>
          {" · "}<Link to="/launch">Launch a coin</Link>
        </span>
      </footer>

      <div className="mobilebar">
        <Link to="/" className="bigbtn" style={{ background: "var(--fill)", color: "var(--ink)", textAlign: "center", textDecoration: "none" }}>Coins</Link>
        <Link to="/launch" className="bigbtn" style={{ textAlign: "center", textDecoration: "none" }}>Launch</Link>
      </div>

      {toast && (
        <div className={"toast " + (toast.kind === "err" ? "err" : toast.kind === "ok" ? "ok" : "")}>
          {toast.kind === "busy" && <span className="spin" />}
          <span>{toast.text}</span>
          {toast.hash && <a href={`${env.explorerUrl}/tx/${toast.hash}`} target="_blank" rel="noreferrer">View</a>}
        </div>
      )}
    </>
  );
}
