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

/** A masthead with a double rule, like the top of a statement. Bottom tabs on phones. */
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
      {DEMO && <div className="demo">Preview with sample coins. <em>Nothing here is on Ethereum yet.</em></div>}
      <header className="mast">
        <div className="mast-in">
          <Link to="/" className="brand"><img src="/icon.svg" alt="" width={28} height={28} />Alicorn</Link>
          <nav className="mnav">
            <NavLink to="/" end className={cls}>Board</NavLink>
            <NavLink to="/launch" className={cls}>Launch</NavLink>
            <NavLink to="/me" className={cls}>Statement</NavLink>
            <NavLink to="/docs" className={cls}>Terms</NavLink>
            {admin && <NavLink to="/admin" className={cls}>Admin</NavLink>}
          </nav>
          <div className="mast-r">
            <span className="mast-eth">ETH <b>{cfg ? usd(cfg.ethUsd) : "—"}</b></span>
            <Link to="/launch" className="b sm">Launch a coin</Link>
            <button className="b pri sm" onClick={() => openWalletModal()}>{isConnected && address ? short(address) : "Connect"}</button>
          </div>
        </div>
        <div className="mast-rule"><i /></div>
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
        <NavLink to="/" end className={cls}><Icon name="receipt" size={20} />Board</NavLink>
        <NavLink to="/launch" className={cls}><Icon name="launch" size={20} />Launch</NavLink>
        <NavLink to="/me" className={cls}><Icon name="wallet" size={20} />Statement</NavLink>
        <NavLink to={admin ? "/admin" : "/docs"} className={cls}>{admin ? <><Icon name="tune" size={20} />Admin</> : <><Icon name="book" size={20} />Terms</>}</NavLink>
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
