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

/** App shell: sidebar on desktop; on phones a top bar with a menu button
 *  that opens the same navigation as a drawer. */
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
  const [q, setQ] = useState("");
  const [menu, setMenu] = useState(false);
  useEffect(() => { setMenu(false); }, [path]);
  const search = (v: string) => { setQ(v); window.dispatchEvent(new CustomEvent("nearpad:search", { detail: v })); };

  const nav = (
    <nav className="snav">
      <NavLink to="/" end className={cls}><Glyph name="coins" size={22} />Coins</NavLink>
      <NavLink to="/create" className={cls}><Glyph name="rocket" size={22} />Create</NavLink>
      <NavLink to="/me" className={cls}><Glyph name="wallet" size={22} />Portfolio</NavLink>
      <NavLink to="/docs" className={cls}><Glyph name="book" size={22} />How it works</NavLink>
      {admin && <NavLink to="/admin" className={cls}><Glyph name="sliders" size={22} />Admin</NavLink>}
    </nav>
  );
  const foot = (
    <div className="side-foot">
      <div className="ccy" style={{ margin: "0 6px 6px" }}>
        <button className={ccy === "NEAR" ? "on" : ""} onClick={() => setCcy("NEAR")}>NEAR</button>
        <button className={ccy === "USD" ? "on" : ""} onClick={() => setCcy("USD")}>USD</button>
      </div>
      <a className="theme" href={BRAND.x} target="_blank" rel="noreferrer"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M18.9 2H22l-7.2 8.2L23 22h-6.6l-5.2-6.8L5.3 22H2.1l7.7-8.8L1.7 2h6.8l4.7 6.2L18.9 2Zm-1.2 18h1.8L7.2 3.9H5.3L17.7 20Z"/></svg><span>{BRAND.x.replace("https://x.com/", "@")}</span></a>
      <button className="theme" onClick={() => setTheme(isDark ? "light" : "dark")}><Icon name={isDark ? "sun" : "moon"} size={18} /><span>{isDark ? "Light mode" : "Dark mode"}</span></button>
    </div>
  );

  return (
    <>
      {DEMO && <div className="demo">Preview with sample data. <em>Nothing here is on NEAR yet.</em></div>}
      <div className="shell">
        <aside className="side">
          <Link to="/" className="brand"><img src="/logo.svg" alt="" width={32} height={32} />{BRAND.name}<span className="chip" style={{ marginLeft: 8, height: 20, fontSize: 11 }}>NEAR</span></Link>
          {nav}
          <Link to="/create" className="b pri wide launchb">Create a coin</Link>
          {foot}
        </aside>

        <div className="mainc">
          <header className="topbar">
            <button className="burger" aria-label="Menu" onClick={() => setMenu(true)}><Icon name="menu" size={22} /></button>
            <Link to="/" className="mbrand"><img src="/logo.svg" alt="" width={30} height={30} />{BRAND.name}</Link>
            <form className="search" onSubmit={(e) => e.preventDefault()}>
              <Icon name="search" size={18} />
              <input placeholder="Search coins" value={q} onChange={(e) => search(e.target.value)} />
            </form>
            <span className="sp" />
            {accountId
              ? <button className="b soft" title="Sign out" onClick={() => signOut()}>{short(accountId, 10)}</button>
              : <button className="b soft" onClick={() => openWalletModal()}>Connect wallet</button>}
          </header>

          <div className="wrap page">
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
        </div>
      </div>

      {menu && (
        <>
          <div className="scrim menu" onClick={() => setMenu(false)} />
          <aside className="drawer">
            <div className="drawer-h"><Link to="/" className="brand"><img src="/logo.svg" alt="" width={30} height={30} />{BRAND.name}</Link><button className="burger" aria-label="Close" onClick={() => setMenu(false)}><Icon name="close" size={22} /></button></div>
            {nav}
            <Link to="/create" className="b pri wide launchb">Create a coin</Link>
            {foot}
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
