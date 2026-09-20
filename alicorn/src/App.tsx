import { useEffect } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { useAccount } from "wagmi";

import { Icon } from "./components/Icon";
import { DEMO, env } from "./lib/env";
import { short, usd } from "./lib/format";
import { useConfig, useIsAdmin, useToast } from "./lib/hooks";
import { openWalletModal } from "./lib/wallet";
import Home from "./pages/Home";
import TokenPage from "./pages/Token";
import Launch from "./pages/Launch";
import Me from "./pages/Me";
import Docs from "./pages/Docs";
import Admin from "./pages/Admin";

/** One thin top bar with underlined links; bottom tabs on phones. */
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
      <header className="top">
        <div className="top-in">
          <Link to="/" className="brand"><img src="/icon.svg" alt="" width={30} height={30} /><span>Ali<em>corn</em></span></Link>
          <nav className="topnav">
            <NavLink to="/" end className={cls}>Coins</NavLink>
            <NavLink to="/launch" className={cls}>Launch</NavLink>
            <NavLink to="/me" className={cls}>Rewards</NavLink>
            <NavLink to="/docs" className={cls}>How it pays</NavLink>
            {admin && <NavLink to="/admin" className={cls}>Admin</NavLink>}
          </nav>
          <div className="top-r">
            <span className="top-eth">ETH <b>{cfg ? usd(cfg.ethUsd) : "—"}</b></span>
            <Link to="/launch" className="b horn sm" style={{ height: 36 }}>Launch a coin</Link>
            <button className="b pri sm" style={{ height: 36 }} onClick={() => openWalletModal()}>{isConnected && address ? short(address) : "Connect"}</button>
          </div>
        </div>
      </header>

      {DEMO && <div className="demo">Design preview with sample coins. <em>Nothing here is on Ethereum yet.</em></div>}
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
        <NavLink to={admin ? "/admin" : "/docs"} className={cls}>{admin ? <><Icon name="tune" size={20} />Admin</> : <><Icon name="book" size={20} />How</>}</NavLink>
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
