import { useEffect, useState } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";

import { Glyph } from "./components/Glyph";
import { Icon } from "./components/Icon";
import { BRAND, DEMO, env } from "./lib/env";
import { short } from "./lib/format";
import { useConfig, useCurrency, useToast } from "./lib/hooks";
import { useTheme } from "./lib/theme";
import { openWalletModal, signOut, useAccount } from "./lib/wallet";
import Home from "./pages/Home";
import TokenPage from "./pages/Token";
import Create from "./pages/Create";
import Portfolio from "./pages/Portfolio";
import Docs from "./pages/Docs";
import Admin from "./pages/Admin";

/** App shell: a sticky app bar with the navigation as a tab strip under it on
 *  phones and centred in the bar on desktop. Settings live in a drawer. */
export default function App() {
  const { accountId } = useAccount();
  const { data: cfg } = useConfig();
  const admin = !!accountId && cfg?.owner === accountId;
  const toast = useToast();
  const loc = useLocation();
  const path = loc.pathname.replace(/\/+$/, "") || "/";
  useEffect(() => { window.scrollTo({ top: 0 }); }, [path]);
  const cls = ({ isActive }: { isActive: boolean }) => (isActive ? "on" : "");
  const [, isDark, setTheme] = useTheme();
  const [ccy, setCcy] = useCurrency();
  const [menu, setMenu] = useState(false);
  useEffect(() => { setMenu(false); }, [path]);

  return (
    <>
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden><defs><linearGradient id="hornGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#4F46E5" /><stop offset=".6" stopColor="#8B5CF6" /><stop offset="1" stopColor="#F0B33F" /></linearGradient></defs></svg>
      {DEMO && <div className="demo">Preview with sample data. <em>Nothing here is on NEAR yet.</em></div>}
      <header className="appbar">
        <div className="row">
          <Link to="/" className="brand"><img src="/logo.svg" alt="" /><span className="name">{BRAND.name}</span><span className="net">NEAR</span></Link>
          <span className="sp" />
          {accountId
            ? <button className="wallet" title="Account" onClick={() => setMenu(true)}>{short(accountId, 7)}</button>
            : <button className="wallet off" onClick={() => openWalletModal()}>Connect</button>}
          <button className="iconbtn" aria-label="Menu" onClick={() => setMenu(true)}><Icon name="menu" size={20} /></button>
        </div>
        <nav className="tabs-nav">
          <NavLink to="/" end className={cls}><Glyph name="coins" />Coins</NavLink>
          <NavLink to="/create" className={cls}><Glyph name="rocket" />Create</NavLink>
          <NavLink to="/me" className={cls}><Glyph name="wallet" />Portfolio</NavLink>
          <NavLink to="/docs" className={cls}><Glyph name="book" />Docs</NavLink>
          {admin && <NavLink to="/admin" className={cls}><Glyph name="sliders" />Admin</NavLink>}
        </nav>
      </header>

      <div className="page">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/t/:account" element={<TokenPage />} />
          <Route path="/create" element={<Create />} />
          <Route path="/me" element={<Portfolio />} />
          <Route path="/docs" element={<Docs />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </div>

      {menu && (
        <>
          <div className="scrim" onClick={() => setMenu(false)} />
          <aside className="drawer">
            <div className="row-flex"><span className="brand"><img src="/logo.svg" alt="" />{BRAND.name}</span><button className="iconbtn close" aria-label="Close" onClick={() => setMenu(false)}><Icon name="close" size={20} /></button></div>
            {accountId && <div className="fine" style={{ padding: "0 12px" }}>Signed in as <b>{accountId}</b></div>}
            <NavLink to="/" end className={cls}><Glyph name="coins" size={18} />Coins</NavLink>
            <NavLink to="/create" className={cls}><Glyph name="rocket" size={18} />Create a coin</NavLink>
            <NavLink to="/me" className={cls}><Glyph name="wallet" size={18} />Portfolio</NavLink>
            <NavLink to="/docs" className={cls}><Glyph name="book" size={18} />How it works</NavLink>
            {admin && <NavLink to="/admin" className={cls}><Glyph name="sliders" size={18} />Admin</NavLink>}
            <div className="foot">
              <div className="seg" style={{ justifySelf: "start" }}>
                <button className={ccy === "NEAR" ? "on" : ""} onClick={() => setCcy("NEAR")}>NEAR</button>
                <button className={ccy === "USD" ? "on" : ""} onClick={() => setCcy("USD")}>USD</button>
              </div>
              <button className="item" onClick={() => setTheme(isDark ? "light" : "dark")}><Icon name={isDark ? "sun" : "moon"} size={18} />{isDark ? "Light mode" : "Dark mode"}</button>
              <a href={BRAND.x} target="_blank" rel="noreferrer"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M18.9 2H22l-7.2 8.2L23 22h-6.6l-5.2-6.8L5.3 22H2.1l7.7-8.8L1.7 2h6.8l4.7 6.2L18.9 2Zm-1.2 18h1.8L7.2 3.9H5.3L17.7 20Z"/></svg>{BRAND.x.replace("https://x.com/", "@")}</a>
              {accountId && <button className="item" onClick={() => { signOut(); setMenu(false); }}><Icon name="close" size={18} />Sign out</button>}
            </div>
          </aside>
        </>
      )}

      {toast && (
        <div className={"toast " + (toast.kind === "err" ? "err" : toast.kind === "ok" ? "ok" : "")}>
          {toast.kind === "busy" && <span className="spin" />}
          <span>{toast.text}</span>
          {toast.hash && <a href={`${env.explorerUrl}/txns/${toast.hash}`} target="_blank" rel="noreferrer">tx</a>}
        </div>
      )}
    </>
  );
}
