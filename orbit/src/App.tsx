import { useEffect, useMemo } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { useAccount } from "wagmi";

import { ADDRESSES, BRAND, env, FEES } from "./lib/env";
import { hype, pct, short, usd, wei } from "./lib/format";
import { useHypeUsd, useIsOwner, useToast, useTokens } from "./lib/hooks";
import { countdown, secondsLeft } from "./lib/onair";
import { openWalletModal } from "./lib/wallet";
import Home from "./pages/Home";
import TokenPage from "./pages/Token";
import Launch from "./pages/Launch";
import Me from "./pages/Me";
import Docs from "./pages/Docs";
import Admin from "./pages/Admin";

/** The ticker: every live coin's price and move, running auctions, then the day's totals. Doubled so the loop is seamless. */
function Tape() {
  const { data: tokens } = useTokens();
  const { data: hypeUsd = 0 } = useHypeUsd();
  const items = useMemo(() => {
    const list = tokens ?? [];
    const vol = list.reduce((s, t) => s + wei(t.volume24hWei) * hypeUsd, 0);
    const out: [string, string, string][] = [["HYPE", usd(hypeUsd), ""]];
    for (const t of list.slice(0, 20)) {
      if (t.auction && !t.auction.finalized) out.push([t.symbol, `AUCTION ${countdown(secondsLeft(t.auction))} · ${hype(wei(t.auction.raised), 1)} HYPE`, "a"]);
      else out.push([t.symbol, `${usd(t.priceUsd)} ${pct(t.priceChange24hPct)}`, (t.priceChange24hPct ?? 0) >= 0 ? "u" : "d"]);
    }
    const running = list.filter((t) => t.auction && !t.auction.finalized && t.auction.open).length;
    out.push(["24H VOL", usd(vol, { compact: true }), ""], ["LIVE AUCTIONS", String(running), "a"], ["COINS", String(list.length), ""], ["FEE", `${FEES.poolPct}% · ${FEES.creatorPct}% creator · ${FEES.platformPct}% platform`, ""]);
    return out;
  }, [tokens, hypeUsd]);
  const seq = [...items, ...items];
  return (
    <div className="tape" aria-hidden="true"><div className="track">{seq.map(([k, v, c], i) => <span key={i}>{k}<b className={c}>{v}</b></span>)}</div></div>
  );
}

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
          <Link to="/" className="brand"><i />{BRAND.name}</Link>
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
      <Tape />

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/t/:address" element={<TokenPage />} />
        <Route path="/launch" element={<Launch />} />
        <Route path="/me" element={<Me />} />
        <Route path="/docs" element={<Docs />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<Home />} />
      </Routes>

      <footer className="foot">
        <span>{BRAND.name} · {env.chainName} · {BRAND.tagline}</span>
        <span>
          <a href={`${env.explorerUrl}/address/${ADDRESSES.factory}`} target="_blank" rel="noreferrer">Factory</a>
          {" · "}<a href={`${env.explorerUrl}/address/${ADDRESSES.house}`} target="_blank" rel="noreferrer">Auction house</a>
          {" · "}<Link to="/docs">How it works</Link>
          {" · "}<Link to="/launch">Launch a coin</Link>
          {owner && <>{" · "}<Link to="/admin">Admin</Link></>}
        </span>
      </footer>

      {path !== "/launch" && !path.startsWith("/t/") && (
        <nav className="tabbar">
          <NavLink to="/" end className={({ isActive }) => (isActive ? "on" : "")}><svg viewBox="0 0 24 24"><path d="M4 20h9M8 20v-5M14 4l6 6-4 4-6-6zM11 10l-7 7" /></svg>Auctions</NavLink>
          <NavLink to="/launch" className={({ isActive }) => (isActive ? "on" : "")}><span className="rec"><i /></span>Launch</NavLink>
          <NavLink to="/me" className={({ isActive }) => (isActive ? "on" : "")}><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="14" rx="2" /><path d="M8 22h8" /></svg>My bids</NavLink>
          <NavLink to={owner ? "/admin" : "/docs"} className={({ isActive }) => (isActive ? "on" : "")}>{owner ? <><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>Admin</> : <><svg viewBox="0 0 24 24"><path d="M5 4h14v16H5zM9 9h6M9 13h6" /></svg>How it works</>}</NavLink>
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
