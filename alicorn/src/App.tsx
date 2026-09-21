import { useEffect, useState } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { useAccount } from "wagmi";

import { Icon } from "./components/Icon";
import { DEMO, env } from "./lib/env";
import { short, usd } from "./lib/format";
import { useConfig, useIsAdmin, useToast } from "./lib/hooks";
import { openWalletModal } from "./lib/wallet";
import { useTheme } from "./lib/theme";
import Home from "./pages/Home";
import TokenPage from "./pages/Token";
import Launch from "./pages/Launch";
import Me from "./pages/Me";
import Docs from "./pages/Docs";
import Admin from "./pages/Admin";

export default function App() {
  const { address, isConnected } = useAccount();
  const admin = useIsAdmin();
  const { data: cfg } = useConfig();
  const toast = useToast();
  const loc = useLocation();
  const path = loc.pathname.replace(/\/+$/, "") || "/";
  useEffect(() => { window.scrollTo({ top: 0 }); }, [path]);
  const cls = ({ isActive }: { isActive: boolean }) => (isActive ? "on" : "");
  const [, isDark, setTheme] = useTheme();
  const [q, setQ] = useState("");

  return (
    <>
      {DEMO && <div className="demo">Preview with sample data. <em>Nothing here is on Ethereum yet.</em></div>}
      <header className="hdr">
        <div className="hdr-in">
          <Link to="/" className="brand"><img src="/icon.svg" alt="" width={34} height={34} />Alicorn</Link>
          <div className="hdr-mid">
            <nav className="nav">
              <NavLink to="/" end className={cls}>Coins</NavLink>
              <NavLink to="/launch" className={cls}>Launch</NavLink>
              <NavLink to="/me" className={cls}>Rewards</NavLink>
              <NavLink to="/docs" className={cls}>Docs</NavLink>
              {admin && <NavLink to="/admin" className={cls}>Admin</NavLink>}
            </nav>
            <form className="hdr-search" onSubmit={(e) => { e.preventDefault(); if (q.trim()) { window.location.hash = ""; window.dispatchEvent(new CustomEvent("alicorn:search", { detail: q.trim() })); } }}>
              <Icon name="search" size={18} />
              <input placeholder="Search coins" value={q} onChange={(e) => { setQ(e.target.value); window.dispatchEvent(new CustomEvent("alicorn:search", { detail: e.target.value })); }} />
            </form>
          </div>
          <div className="hdr-r">
            <span className="hdr-eth">ETH <b>{cfg ? usd(cfg.ethUsd) : "—"}</b></span>
            <button className="theme" aria-label="Toggle theme" onClick={() => setTheme(isDark ? "light" : "dark")}><Icon name={isDark ? "sun" : "moon"} size={18} /></button>
            <Link to="/launch" className="b pri">Launch</Link>
            <button className="b soft" onClick={() => openWalletModal()}>{isConnected && address ? short(address) : "Connect"}</button>
          </div>
        </div>
      </header>

      <div className="wrap page">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/t/:address" element={<TokenPage />} />
          <Route path="/launch" element={<Launch />} />
          <Route path="/me" element={<Me />} />
          <Route path="/docs" element={<Docs />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </div>

      <nav className="tabbar">
        <NavLink to="/" end className={cls}><Icon name="receipt" size={20} />Coins</NavLink>
        <NavLink to="/launch" className={cls}><Icon name="launch" size={20} />Launch</NavLink>
        <NavLink to="/me" className={cls}><Icon name="wallet" size={20} />Rewards</NavLink>
        <NavLink to={admin ? "/admin" : "/docs"} className={cls}>{admin ? <><Icon name="tune" size={20} />Admin</> : <><Icon name="book" size={20} />Docs</>}</NavLink>
      </nav>

      {toast && (
        <div className={"toast " + (toast.kind === "err" ? "err" : toast.kind === "ok" ? "ok" : "")}>
          {toast.kind === "busy" && <span className="spin" />}
          <span>{toast.text}</span>
          {toast.hash && <a href={`${env.explorerUrl}/tx/${toast.hash}`} target="_blank" rel="noreferrer">tx</a>}
        </div>
      )}
    </>
  );
}
