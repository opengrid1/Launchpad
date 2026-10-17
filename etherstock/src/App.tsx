import { useEffect, useMemo } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { useAccount } from "wagmi";

import { Icon } from "./components/Icon";
import { BRAND, DEMO, env, isHidden } from "./lib/env";
import { pct, short, usd, wei } from "./lib/format";
import { useConfig, useIsAdmin, useToast, useTokens } from "./lib/hooks";
import { openWalletModal } from "./lib/wallet";
import Home from "./pages/Home";
import TokenPage from "./pages/Token";
import Launch from "./pages/Launch";
import Me from "./pages/Me";
import Docs from "./pages/Docs";
import Admin from "./pages/Admin";

/** Left rail on desktop, compact header plus bottom tabs on phones, and a
 *  running tape of the board across the top of the content. */
export default function App() {
  const { address, isConnected } = useAccount();
  const admin = useIsAdmin();
  const { data: cfg } = useConfig();
  const toast = useToast();
  const loc = useLocation();
  const path = loc.pathname.replace(/\/+$/, "") || "/";
  useEffect(() => { window.scrollTo({ top: 0 }); }, [path]);
  const cls = ({ isActive }: { isActive: boolean }) => (isActive ? "on" : "");
  const brand = <><img src="/icon.svg" alt="" width={28} height={28} /><span>ETHER<em>STOCK</em></span></>;
  const connect = <button className="b pri" onClick={() => openWalletModal()}>{isConnected && address ? short(address) : "Connect"}</button>;

  return (
    <div className="shell">
      <aside className="rail">
        <Link to="/" className="rail-brand">{brand}</Link>
        <nav className="rail-nav">
          <NavLink to="/" end className={cls}><Icon name="receipt" size={18} />Board</NavLink>
          <NavLink to="/launch" className={cls}><Icon name="launch" size={18} />Launch<span className="k">new</span></NavLink>
          <NavLink to="/me" className={cls}><Icon name="wallet" size={18} />Portfolio</NavLink>
          <NavLink to="/docs" className={cls}><Icon name="book" size={18} />Rules</NavLink>
          {admin && <NavLink to="/admin" className={cls}><Icon name="tune" size={18} />Admin</NavLink>}
        </nav>
        <div className="rail-foot">
          <div className="rail-eth"><span>ETH</span><b>{cfg ? usd(cfg.ethUsd) : "—"}</b></div>
          {connect}
          <a className="rail-x" href={BRAND.x} target="_blank" rel="noreferrer">{BRAND.x.replace("https://x.com/", "@")} · Ethereum mainnet</a>
        </div>
      </aside>

      <div className="main">
        <header className="mhead"><Link to="/" className="rail-brand">{brand}</Link>{connect}</header>
        <Tape />
        {DEMO && <div className="demo">Design preview with sample coins. Nothing here is on Ethereum yet.</div>}
        <div className="content">
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
      </div>

      <nav className="tabbar">
        <NavLink to="/" end className={cls}><Icon name="receipt" size={20} />Board</NavLink>
        <NavLink to="/launch" className={cls}><Icon name="launch" size={20} />Launch</NavLink>
        <NavLink to="/me" className={cls}><Icon name="wallet" size={20} />Portfolio</NavLink>
        <NavLink to={admin ? "/admin" : "/docs"} className={cls}>{admin ? <><Icon name="tune" size={20} />Admin</> : <><Icon name="book" size={20} />Rules</>}</NavLink>
      </nav>

      {toast && (
        <div className={"toast " + (toast.kind === "err" ? "err" : toast.kind === "ok" ? "ok" : "")}>
          {toast.kind === "busy" && <span className="spin" />}
          <span>{toast.text}</span>
          {toast.hash && <a href={`${env.explorerUrl}/tx/${toast.hash}`} target="_blank" rel="noreferrer">tx</a>}
        </div>
      )}
    </div>
  );
}

/** The tape: every coin's cap, move and burned share, scrolling. Doubled so the loop is seamless. */
function Tape() {
  const { data: tokens } = useTokens();
  const items = useMemo(() => (tokens ?? []).filter((t) => !isHidden(t.address)).slice(0, 40), [tokens]);
  if (items.length === 0) return null;
  const run = [...items, ...items];
  return (
    <div className="tape" aria-hidden="true">
      <div className="tape-in" style={{ animationDuration: `${Math.max(30, items.length * 4)}s` }}>
        {run.map((t, i) => {
          const c = t.priceChange24hPct;
          const burned = t.burn ? (Number(t.burn.burned) / 1e27) * 100 : 0;
          return (
            <Link key={t.address + i} to={`/t/${t.address}`} className="tape-it">
              <b>{t.symbol}</b>
              <span>{usd(t.marketCapUsd, { compact: true })}</span>
              <span className={c == null ? "" : c >= 0 ? "up" : "down"}>{c == null ? "new" : pct(c)}</span>
              <span className="fire">{burned > 0 ? `${burned.toFixed(2)}% burned` : `${wei(t.burn?.reserve ?? 0n) > 0 ? "reserve filling" : "no burn yet"}`}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
