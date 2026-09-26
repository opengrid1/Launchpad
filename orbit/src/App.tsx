import { useEffect } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { useAccount } from "wagmi";

import { BRAND, env } from "./lib/env";
import { short } from "./lib/format";
import { useIsOwner, useToast } from "./lib/hooks";
import { openWalletModal } from "./lib/wallet";
import { Icon } from "./components/Icon";
import Home from "./pages/Home";
import TokenPage from "./pages/Token";
import Launch from "./pages/Launch";
import Me from "./pages/Me";
import Docs from "./pages/Docs";
import Admin from "./pages/Admin";

export default function App() {
  const { address, isConnected } = useAccount();
  const owner = useIsOwner();
  const toast = useToast();
  const loc = useLocation();
  const path = loc.pathname.replace(/\/+$/, "") || "/";
  useEffect(() => { window.scrollTo({ top: 0 }); }, [path]);

  return (
    <>
      <header className="top">
        <div className="top-in">
          <Link to="/" className="brand">{BRAND.name}</Link>
          <nav className="nav">
            <NavLink to="/" end className={({ isActive }) => (isActive ? "on" : "")}>Auctions</NavLink>
            <NavLink to="/launch" className={({ isActive }) => (isActive ? "on" : "")}>Launch</NavLink>
            <NavLink to="/me" className={({ isActive }) => (isActive ? "on" : "")}>My bids</NavLink>
            <NavLink to="/docs" className={({ isActive }) => (isActive ? "on" : "")}>How it works</NavLink>
            {owner && <NavLink to="/admin" className={({ isActive }) => (isActive ? "on" : "")}>Admin</NavLink>}
          </nav>
          <div className="top-r">
            <Link to="/launch" className="btn red">Launch a coin</Link>
            <button className="btn ghost" onClick={() => openWalletModal()}>
              {isConnected && address ? <><span className="dot g" style={{ marginRight: 8, width: 7, height: 7 }} />{short(address)}</> : "Connect"}
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
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<Home />} />
      </Routes>


      {path !== "/launch" && !path.startsWith("/t/") && (
        <nav className="tabbar">
          <NavLink to="/" end className={({ isActive }) => (isActive ? "on" : "")}><Icon name="gavel" />Auctions</NavLink>
          <NavLink to="/launch" className={({ isActive }) => (isActive ? "on" : "")}><span className="rec"><Icon name="launch" size={16} /></span>Launch</NavLink>
          <NavLink to="/me" className={({ isActive }) => (isActive ? "on" : "")}><Icon name="wallet" />My bids</NavLink>
          <NavLink to={owner ? "/admin" : "/docs"} className={({ isActive }) => (isActive ? "on" : "")}>{owner ? <><Icon name="tune" />Admin</> : <><Icon name="info" />How it works</>}</NavLink>
        </nav>
      )}

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
