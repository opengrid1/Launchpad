import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useAccount } from "wagmi";

import { Icon, Logo } from "./components/Icon";
import { BRAND, env, listed } from "./lib/env";
import { pct, short, usd } from "./lib/format";
import { useConfig, useIsAdmin, useToast, useTokens } from "./lib/hooks";
import { openWalletModal } from "./lib/wallet";
import Home from "./pages/Home";
import TokenPage from "./pages/Token";
import Launch from "./pages/Launch";
import Me from "./pages/Me";
import Stats from "./pages/Stats";
import Admin from "./pages/Admin";

const NAVS = [
  { to: "/", icon: "coins", label: "Coins", end: true },
  { to: "/launch", icon: "launch", label: "Launch" },
  { to: "/me", icon: "wallet", label: "Portfolio" },
  { to: "/stats", icon: "stats", label: "Stats" },
] as const;

/** Glass header with the pill nav on desktop, floating tab bar on phones. */
export default function App() {
  const { address, isConnected } = useAccount();
  const admin = useIsAdmin();
  const { data: cfg } = useConfig();
  const toast = useToast();
  const loc = useLocation();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const path = loc.pathname.replace(/\/+$/, "") || "/";
  useEffect(() => { window.scrollTo({ top: 0 }); }, [path]);
  const cls = ({ isActive }: { isActive: boolean }) => (isActive ? "on" : "");
  const onCoin = path.startsWith("/t/");
  const submitSearch = (e: React.FormEvent) => { e.preventDefault(); const s = q.trim(); if (!s) return; nav(`/?q=${encodeURIComponent(s)}`); };

  return (
    <div className="app">
      <header className="top"><div className="topin">
        <Link className="brand" to="/"><Logo /><span className="word">Estonks</span><span className="badge eth">ETH</span></Link>
        <nav className="topnav" aria-label="Main">
          {NAVS.map((n) => <NavLink key={n.to} to={n.to} end={"end" in n} className={cls}>{n.label}</NavLink>)}
          {admin && <NavLink to="/admin" className={cls}>Admin</NavLink>}
        </nav>
        <div className="tools">
          <form className="search" onSubmit={submitSearch}><Icon name="search" size={16} /><input type="search" placeholder="Search coins" aria-label="Search coins" value={q} onChange={(e) => setQ(e.target.value)} /></form>
          <Link className="ico" to="/?focus=1" aria-label="Search"><Icon name="search" size={18} /></Link>
          <span className="tick"><i />ETH <b>{cfg ? usd(cfg.ethUsd) : "…"}</b></span>
          <button className="wallet" onClick={() => openWalletModal()}>{isConnected && <span className="av" />}<span className="addr">{isConnected && address ? short(address) : "Connect"}</span><Icon name="down" size={14} className="chev" /></button>
        </div>
      </div></header>

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/t/:address" element={<TokenPage />} />
        <Route path="/launch" element={<Launch />} />
        <Route path="/me" element={<Me />} />
        <Route path="/stats" element={<Stats />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<Home />} />
      </Routes>

      {!onCoin && (
        <footer className="footer">
          <span>Contracts verified on <a href={`${env.explorerUrl}/address/${cfg ? "" : ""}`.replace(/\/address\/$/, "/address/0x12f4d0eAEe4ea0cEf7722aF00989D5210417DaD9")} target="_blank" rel="noreferrer">Etherscan</a>.</span>
          <span><a href={BRAND.x} target="_blank" rel="noreferrer">X</a> · <a href={BRAND.telegram} target="_blank" rel="noreferrer">Telegram</a></span>
        </footer>
      )}

      {!onCoin && (
        <nav className="nav" aria-label="Main">
          {NAVS.map((n) => <NavLink key={n.to} to={n.to} end={"end" in n} className={cls}><Icon name={n.icon} />{n.label}</NavLink>)}
        </nav>
      )}

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

/** Ticker tape of every visible coin: symbol, cap and 24h move, doubled for a seamless loop. */
export function Tape() {
  const { data: tokens } = useTokens();
  const items = useMemo(() => (tokens ?? []).filter(listed).slice(0, 40), [tokens]);
  if (items.length === 0) return null;
  const run = [...items, ...items];
  return (
    <div className="tape" aria-hidden="true">
      <div className="track" style={{ animationDuration: `${Math.max(24, items.length * 5)}s` }}>
        {run.map((t, i) => {
          const c = t.priceChange24hPct;
          return <Link key={t.address + i} to={`/t/${t.address}`} className={c == null ? "launch" : c >= 0 ? "buy" : "sell"}><i /><b>{t.symbol}</b>{usd(t.marketCapUsd, { compact: true })} · {c == null ? "new" : pct(c)}</Link>;
        })}
      </div>
    </div>
  );
}
