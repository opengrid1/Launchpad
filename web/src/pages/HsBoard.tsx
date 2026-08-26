import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTokens } from "@launchpad/sdk/react";
import type { TokenSummary } from "@launchpad/sdk";

import { WHYPE, stockByAddress } from "../lib/hyper/stocks";
import { client } from "../lib/client";
import { env } from "../lib/env";
import { fmtUsd, timeAgo } from "../lib/format";
import { isHidden, isImpersonator } from "../lib/hiddenTokens";
import { isOfficial } from "../lib/official";
import { OFFICIAL_LOGOS } from "../lib/officialLogos";
import { volUsd } from "../components/market/util";
import { KoiIcon } from "../components/base/KoiIcon";
import { HyperMark } from "../components/HyperMark";
import { DEFAULT_TOKEN_LOGO } from "../lib/hyper/defaultLogo";
import { INK_PREVIEW, PREVIEW_ON } from "../lib/base/preview";
import { ensureSdkWallet, errorText, useWallet } from "../lib/useWallet";
import { useUi } from "../store";

/** Quick-buy sizes in the chain's native token; the bolt fires a real buy. */
const QUICK_BUY_AMOUNTS = env.nativeSymbol === "ETH" ? [0.005, 0.01, 0.05, 0.1] : [1, 5, 10, 25];

function useQuickBuy(token: `0x${string}`, symbol: string, onDone?: () => void) {
  const { isConnected, connectFirst } = useWallet();
  const pushToast = useUi((s) => s.pushToast);
  const [busyAmt, setBusyAmt] = useState<number | null>(null);
  const buy = async (amt: number) => {
    if (busyAmt != null) return;
    if (!isConnected) { onDone?.(); return connectFirst(); }
    setBusyAmt(amt);
    try {
      if (!(await ensureSdkWallet())) throw new Error("Wallet session expired. Reconnect and try again.");
      const hash = await (client as any).buyToken(token, BigInt(Math.round(amt * 1e18)), 0n);
      pushToast({ kind: "success", title: `Buying ${amt} ${env.nativeSymbol} of ${symbol}`, txHash: hash });
      onDone?.();
    } catch (err) {
      pushToast({ kind: "error", title: "Quick buy failed", body: errorText(err) });
    } finally {
      setBusyAmt(null);
    }
  };
  return { buy, busyAmt };
}

/** The row's bolt: tap to reveal native-token presets, each a real buy. */
function BoltBuy({ token, symbol }: { token: `0x${string}`; symbol: string }) {
  const [open, setOpen] = useState(false);
  const { buy, busyAmt } = useQuickBuy(token, symbol, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (!el.closest?.(`[data-gmqb="${token}"]`)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open, token]);
  return (
    <span className="gm-qb" data-gmqb={token} onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
      {open ? (
        <span className="gm-qb-pop">
          {QUICK_BUY_AMOUNTS.map((a) => (
            <button key={a} disabled={busyAmt != null} onClick={() => buy(a)}>
              {busyAmt === a ? "…" : a}
            </button>
          ))}
        </span>
      ) : null}
      <button className={`gm-bolt ${open ? "on" : ""}`} aria-label={`Quick buy ${symbol}`} onClick={() => setOpen((o) => !o)}>
        <KoiIcon name="zap" size={15} />
        <span>{QUICK_BUY_AMOUNTS[0]}</span>
      </button>
    </span>
  );
}

type Tab = "pulse" | "new" | "surge" | "top";
const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "pulse", label: "Pulse", icon: <KoiIcon name="zap" size={14} /> },
  { id: "new", label: "New", icon: <KoiIcon name="clock" size={14} /> },
  { id: "surge", label: "Surge", icon: <KoiIcon name="trending-up" size={14} /> },
  { id: "top", label: "Top", icon: <KoiIcon name="trophy" size={14} /> },
];

// Design-preview fixtures live in lib/base/preview (shared with Analytics).

const pairSymbolOf = (t: TokenSummary): string => {
  const meta = t.metadata as any;
  const addr = meta?.pairAddress as string | undefined;
  if (addr) {
    if (addr.toLowerCase() === WHYPE.toLowerCase()) return env.nativeSymbol;
    const st = stockByAddress(addr);
    if (st) return st.ticker;
  }
  const p = meta?.pair as string | undefined;
  if (p) return /^w?hype$/i.test(p) ? env.nativeSymbol : p;
  return env.nativeSymbol;
};

function logoSrc(t: TokenSummary): string | null {
  const logo = OFFICIAL_LOGOS[t.address?.toLowerCase()] ?? t.metadata?.logo;
  if (!logo || !/^(https?:|ipfs:|data:)/.test(String(logo))) return null;
  return String(logo).startsWith("ipfs://") ? `https://ipfs.io/ipfs/${String(logo).slice(7)}` : String(logo);
}

function Avatar({ t }: { t: TokenSummary }) {
  const [failed, setFailed] = useState(false);
  const src = (failed ? null : logoSrc(t)) ?? DEFAULT_TOKEN_LOGO;
  return (
    <span className="gm-ava">
      <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
      <span className="gm-ava-badge"><HyperMark /></span>
    </span>
  );
}

function priceUsdOf(t: TokenSummary): number {
  const mc = Number(t.marketCapUsd);
  return mc > 0 ? mc / 1_000_000_000 : 0;
}
function fmtPrice(p: number): string {
  if (p <= 0) return "—";
  if (p >= 1) return `$${p.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (p >= 0.01) return `$${p.toFixed(4)}`;
  return `$${Number(p.toPrecision(3)).toString()}`;
}

/**
 * squidpad markets — GMGN-style terminal feed: icon filter pills over dense
 * multi-stat rows (volume, market cap, trades, holders proxy) with an inline
 * bolt quick-buy on every row. One layout at every breakpoint; desktop just
 * breathes wider inside the shell.
 */
export function HsBoard() {
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get("tab") as Tab) || "pulse";
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  const { data: byVolume, loading: lv } = useTokens(client, { sort: "volume", limit: 100 });
  const { data: byNew, loading: ln } = useTokens(client, { sort: "new", limit: 100 });

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query.trim().toLowerCase()), 130);
    return () => window.clearTimeout(id);
  }, [query]);

  const setTab = (id: Tab) => {
    const n = new URLSearchParams(sp);
    if (id === "pulse") n.delete("tab"); else n.set("tab", id);
    setSp(n, { replace: true });
  };

  const all = useMemo(() => {
    if (env.hideTokens) return [] as TokenSummary[];
    const seen = new Map<string, TokenSummary>();
    for (const t of [...(byVolume ?? []), ...(byNew ?? [])]) {
      if (!isHidden(t.address) && !isImpersonator(t)) seen.set(t.address.toLowerCase(), t);
    }
    const live = [...seen.values()];
    return live.length === 0 && PREVIEW_ON ? INK_PREVIEW : live;
  }, [byVolume, byNew]);

  const feed = useMemo(() => {
    let list = all;
    if (debounced) list = list.filter((t) => t.name.toLowerCase().includes(debounced) || t.symbol.toLowerCase().includes(debounced) || t.address.toLowerCase() === debounced);
    const s = [...list];
    if (tab === "new") s.sort((a, b) => b.createdAt - a.createdAt);
    else if (tab === "surge") s.sort((a, b) => (b.priceChange24hPct ?? -999) - (a.priceChange24hPct ?? -999) || volUsd(b) - volUsd(a));
    else if (tab === "top") s.sort((a, b) => Number(b.marketCapUsd) - Number(a.marketCapUsd));
    else s.sort((a, b) => (b.txCount24h ?? 0) - (a.txCount24h ?? 0) || b.createdAt - a.createdAt); // pulse: live activity
    return s;
  }, [all, debounced, tab]);

  const loading = !env.hideTokens && (lv || ln) && all.length === 0;

  return (
    <div className="gm-page">
      {/* Icon filter pills + expanding search, GMGN style */}
      <div className="gm-bar">
        {TABS.map((t) => (
          <button key={t.id} className={`gm-pill ${tab === t.id ? "on" : ""}`} onClick={() => setTab(t.id)}>
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
        <span className="gm-sp" />
        {searchOpen ? (
          <label className="gm-search">
            <KoiIcon name="search" size={14} />
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, ticker, CA" type="search"
              onBlur={() => { if (!query) setSearchOpen(false); }} />
          </label>
        ) : (
          <button className="gm-pill icon" aria-label="Search" onClick={() => setSearchOpen(true)}>
            <KoiIcon name="search" size={15} />
          </button>
        )}
      </div>

      {/* Dense rows */}
      <div className="gm-list">
        {loading ? (
          [...Array(9)].map((_, i) => <div key={i} className="gm-skel" />)
        ) : feed.length === 0 ? (
          <div className="gm-empty">
            {debounced ? "No coin matches that." : "No coins in the water yet."} <Link to="/launch">Launch the first one</Link>.
          </div>
        ) : (
          feed.map((t) => {
            const chg = t.priceChange24hPct;
            const has = chg != null && isFinite(chg);
            const official = isOfficial(t.address);
            return (
              <Link to={`/token/${t.address}`} key={t.address} className="gm-row">
                <Avatar t={t} />
                <span className="gm-mid">
                  <span className="gm-l1">
                    <b>{t.symbol}</b>
                    <span className="nm">{t.name}</span>
                    {official ? <span className="gm-tag">OFFICIAL</span> : null}
                    <span className="age"><KoiIcon name="clock" size={11} />{t.createdAt ? timeAgo(t.createdAt) : "—"}</span>
                  </span>
                  <span className="gm-l2">
                    <span>V <b>{volUsd(t) > 0 ? fmtUsd(volUsd(t)) : "$0"}</b></span>
                    <span>MC <b>{Number(t.marketCapUsd) > 0 ? fmtUsd(t.marketCapUsd) : "—"}</b></span>
                    <span><KoiIcon name="group" size={11} /> <b>{t.txCount24h ?? 0}</b> tx</span>
                    <span className="pair">{pairSymbolOf(t)}</span>
                  </span>
                </span>
                <span className="gm-right">
                  <span className="p">{fmtPrice(priceUsdOf(t))}</span>
                  <span className={`c ${has ? (chg! >= 0 ? "up" : "down") : "flat"}`}>
                    {has ? `${chg! >= 0 ? "+" : ""}${chg!.toFixed(1)}%` : "0.0%"}
                  </span>
                </span>
                <BoltBuy token={t.address as `0x${string}`} symbol={t.symbol} />
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
