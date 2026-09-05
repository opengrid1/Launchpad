import { useEffect } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { useAccount } from "wagmi";

import { Icon } from "./components/Icon";
import { BRAND, env } from "./lib/env";
import { short, usd } from "./lib/format";
import { useConfig, useIsAdmin, useToast } from "./lib/hooks";
import { openWalletModal } from "./lib/wallet";
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

  return (
    <>
      <header className="bar">
        <div className="bar-in">
          <Link to="/" className="brand"><i />{BRAND.name}</Link>
          <nav className="nav">
            <NavLink to="/" end className={cls}>Coins</NavLink>
            <NavLink to="/launch" className={cls}>Launch</NavLink>
            <NavLink to="/me" className={cls}>Mine</NavLink>
            <NavLink to="/docs" className={cls}>How it works</NavLink>
            {admin && <NavLink to="/admin" className={cls}>Admin</NavLink>}
          </nav>
          <div className="bar-r">
            <span className="bar-eth">ETH <b>{cfg ? usd(cfg.ethUsd) : "—"}</b></span>
            <Link to="/launch" className="btn acc">Launch a coin</Link>
            <button className="btn ink" onClick={() => openWalletModal()}>{isConnected && address ? short(address) : "Connect"}</button>
          </div>
        </div>
      </header>

      <div className="wrap">
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

      {path !== "/launch" && !path.startsWith("/t/") && (
        <nav className="tabbar">
          <NavLink to="/" end className={cls}><Icon name="receipt" size={20} />Coins</NavLink>
          <NavLink to="/launch" className={cls}><Icon name="launch" size={20} />Launch</NavLink>
          <NavLink to="/me" className={cls}><Icon name="wallet" size={20} />Mine</NavLink>
          <NavLink to={admin ? "/admin" : "/docs"} className={cls}>{admin ? <><Icon name="tune" size={20} />Admin</> : <><Icon name="info" size={20} />How</>}</NavLink>
        </nav>
      )}

      {toast && (
        <div className={"toast " + (toast.kind === "err" ? "err" : toast.kind === "ok" ? "ok" : "")}>
          {toast.kind === "busy" && <span className="spin" />}
          <span>{toast.text}</span>
          {toast.hash && <a href={`${env.explorerUrl}/tx/${toast.hash}`} target="_blank" rel="noreferrer">View tx</a>}
        </div>
      )}
    </>
  );
}
