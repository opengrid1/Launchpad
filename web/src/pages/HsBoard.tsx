import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTokens } from "@launchpad/sdk/react";
import type { TokenSummary } from "@launchpad/sdk";

import { WHYPE, hyperStockByAddress, HYPER_STOCKS } from "../lib/hyper/stocks";
import { client } from "../lib/client";
import { env } from "../lib/env";
import { fmtUsd, timeAgo } from "../lib/format";
import { isHidden, isImpersonator } from "../lib/hiddenTokens";
import { isOfficial } from "../lib/official";
import { OFFICIAL_LOGOS } from "../lib/officialLogos";
import { volUsd } from "../components/market/util";
import { HyperMark } from "../components/HyperMark";
import { DEFAULT_TOKEN_LOGO } from "../lib/hyper/defaultLogo";
import { ensureSdkWallet, errorText, useWallet } from "../lib/useWallet";
import { useUi } from "../store";

const QUICK_BUY_AMOUNTS = [1, 5, 10, 25];

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

function QuickBuy({ token, symbol }: { token: `0x${string}`; symbol: string }) {
  const [open, setOpen] = useState(false);
  const { buy, busyAmt } = useQuickBuy(token, symbol, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (!el.closest?.(`[data-hsqb="${token}"]`)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open, token]);
  return (
    <span className="hs-qb" data-hsqb={token} onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
      {open ? (
        QUICK_BUY_AMOUNTS.map((a) => (
          <button key={a} className="hs-qb-amt" disabled={busyAmt != null} onClick={() => buy(a)}>
            {busyAmt === a ? "…" : a}
          </button>
        ))
      ) : (
        <button className="hs-qb-open" onClick={() => setOpen(true)}>Buy</button>
      )}
    </span>
  );
}

type Tab = "top" | "trending" | "movers" | "new" | "live";
const TABS: { id: Tab; label: string; live?: boolean }[] = [
  { id: "movers", label: "Movers" },
  { id: "top", label: "Top" },
  { id: "trending", label: "Trending" },
  { id: "new", label: "New" },
  { id: "live", label: "Live", live: true },
];

const pairSymbolOf = (t: TokenSummary): string => {
  const meta = t.metadata as any;
  const addr = meta?.pairAddress as string | undefined;
  if (addr) {
    if (addr.toLowerCase() === WHYPE.toLowerCase()) return env.nativeSymbol;
    const st = hyperStockByAddress(addr);
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

function Avatar({ t, size = 34 }: { t: TokenSummary; size?: number }) {
  const [failed, setFailed] = useState(false);
  const src = (failed ? null : logoSrc(t)) ?? DEFAULT_TOKEN_LOGO;
  return (
    <span className="hs-ava" style={{ width: size, height: size }}>
      <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
      <span className="hs-ava-badge"><HyperMark /></span>
    </span>
  );
}

/** Price per token derived from market cap over the fixed 1B supply. */
function priceUsdOf(t: TokenSummary): number {
  const mc = Number(t.marketCapUsd);
  return mc > 0 ? mc / 1_000_000_000 : 0;
}

/** Sub-cent prices keep three significant digits; larger ones read normally. */
function fmtPrice(p: number): string {
  if (p <= 0) return "—";
  if (p >= 1) return `$${p.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (p >= 0.01) return `$${p.toFixed(4)}`;
  const s = p.toPrecision(3);
  return `$${Number(s).toString()}`;
}

function Chg({ v }: { v: number | null | undefined }) {
  const has = v != null && isFinite(v);
  const cls = has ? (v! >= 0 ? "up" : "down") : "flat";
  return <span className={`hs-chg ${cls}`}>{has ? `${v! >= 0 ? "+" : ""}${v!.toFixed(2)}%` : "0.00%"}</span>;
}

/**
 * hyperstock markets — terminal split view: the coin ledger on the left, a
 * live detail panel for the selected coin on the right. Selecting a row swaps
 * the panel in place; opening the market goes to the full token page. On
 * mobile the panel is skipped and rows navigate directly.
 */
export function HsBoard() {
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get("tab") as Tab) || "top";
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const navigate = useNavigate();

  const { data: byVolume, loading: lv } = useTokens(client, { sort: "volume", limit: 100 });
  const { data: byNew, loading: ln } = useTokens(client, { sort: "new", limit: 100 });

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query.trim().toLowerCase()), 130);
    return () => window.clearTimeout(id);
  }, [query]);

  const setTab = (id: Tab) => {
    const n = new URLSearchParams(sp);
    if (id === "top") n.delete("tab"); else n.set("tab", id);
    setSp(n, { replace: true });
  };

  const all = useMemo(() => {
    if (env.hideTokens) return [] as TokenSummary[];
    const seen = new Map<string, TokenSummary>();
    for (const t of [...(byVolume ?? []), ...(byNew ?? [])]) {
      if (!isHidden(t.address) && !isImpersonator(t)) seen.set(t.address.toLowerCase(), t);
    }
    return [...seen.values()];
  }, [byVolume, byNew]);

  const feed = useMemo(() => {
    let list = all;
    if (debounced) list = list.filter((t) => t.name.toLowerCase().includes(debounced) || t.symbol.toLowerCase().includes(debounced) || t.address.toLowerCase() === debounced);
    const s = [...list];
    if (tab === "top") s.sort((a, b) => Number(b.marketCapUsd) - Number(a.marketCapUsd));
    else if (tab === "trending") s.sort((a, b) => volUsd(b) - volUsd(a));
    else if (tab === "new") s.sort((a, b) => b.createdAt - a.createdAt);
    else if (tab === "live") s.sort((a, b) => (b.txCount24h ?? 0) - (a.txCount24h ?? 0) || b.createdAt - a.createdAt);
    else s.sort((a, b) => (b.priceChange24hPct ?? -999) - (a.priceChange24hPct ?? -999) || volUsd(b) - volUsd(a));
    return s;
  }, [all, debounced, tab]);

  const selected = useMemo(
    () => feed.find((t) => t.address.toLowerCase() === sel) ?? feed[0] ?? null,
    [feed, sel],
  );

  const loading = !env.hideTokens && (lv || ln) && all.length === 0;
  const isDesktop = () => window.innerWidth >= 1024;

  const stats = useMemo(() => ({
    coins: all.length,
    vol: all.reduce((s, t) => s + volUsd(t), 0),
    mcap: all.reduce((s, t) => s + Math.max(0, Number(t.marketCapUsd) || 0), 0),
  }), [all]);

  return (
    <div className="hs-split">
      {/* LEFT: the ledger */}
      <section className="hs-ledger">
        <div className="hs-ledger-head">
          <h1>Markets</h1>
          <span className="hs-ledger-stats">
            {stats.coins} coins · {fmtUsd(stats.vol)} 24h · {fmtUsd(stats.mcap)} cap
          </span>
        </div>
        <div className="hs-controls">
          <nav className="hs-tabs" aria-label="Market views">
            {TABS.map((t) => (
              <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
                {t.live ? <span className="hs-live" /> : null}{t.label}
              </button>
            ))}
          </nav>
          <label className="hs-search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" type="search" />
          </label>
        </div>
        <div className="hs-list" role="listbox" aria-label="Coins">
          {loading ? (
            [...Array(8)].map((_, i) => <div key={i} className="hs-rowskel" />)
          ) : feed.length === 0 ? (
            <div className="hs-empty">
              {debounced ? "No coin matches that." : "No coins yet."} <Link to="/launch">Launch the first one</Link>.
            </div>
          ) : (
            feed.map((t, i) => {
              const active = selected?.address === t.address;
              return (
                <button
                  key={t.address}
                  className={`hs-li ${active ? "on" : ""}`}
                  role="option"
                  aria-selected={active}
                  onClick={() => (isDesktop() ? setSel(t.address.toLowerCase()) : navigate(`/token/${t.address}`))}
                >
                  <span className="c-rank">{i + 1}</span>
                  <Avatar t={t} size={32} />
                  <span className="hs-coin-id">
                    <span className="n">{t.name}{isOfficial(t.address) ? <span className="hs-tag official">Official</span> : null}</span>
                    <span className="s">{t.symbol} / {pairSymbolOf(t)}</span>
                  </span>
                  <span className="hs-li-right">
                    <span className="p">{Number(t.marketCapUsd) > 0 ? fmtUsd(t.marketCapUsd) : "—"}</span>
                    <Chg v={t.priceChange24hPct} />
                  </span>
                </button>
              );
            })
          )}
        </div>
      </section>

      {/* RIGHT: live detail panel for the selected coin (desktop only) */}
      <section className="hs-detail">
        {selected ? <DetailPane t={selected} /> : (
          <div className="hs-detail-empty">
            <img src={DEFAULT_TOKEN_LOGO} alt="" />
            <p>Select a coin on the left.</p>
          </div>
        )}
      </section>
    </div>
  );
}

/** The right-hand market panel: identity, price block, ledger stats, story,
 *  quick buys and the door into the full market page. */
function DetailPane({ t }: { t: TokenSummary }) {
  const meta = (t.metadata ?? {}) as any;
  const price = priceUsdOf(t);
  const chg = t.priceChange24hPct;
  const official = isOfficial(t.address);
  const { buy, busyAmt } = useQuickBuy(t.address as `0x${string}`, t.symbol);
  return (
    <div className="hs-pane" key={t.address}>
      <div className="hs-pane-id">
        <Avatar t={t} size={46} />
        <div className="hs-pane-name">
          <h2>{t.name} {official ? <span className="hs-tag official">Official</span> : null}</h2>
          <span>{t.symbol} / {pairSymbolOf(t)} · HyperEVM</span>
        </div>
        <Link to={`/token/${t.address}`} className="hs-pane-open">Open market</Link>
      </div>

      <div className="hs-pane-price">
        <span className="v">{fmtPrice(price)}</span>
        <Chg v={chg} />
      </div>

      <div className="hs-pane-grid">
        <div><span className="l">Market cap</span><span className="v">{Number(t.marketCapUsd) > 0 ? fmtUsd(t.marketCapUsd) : "—"}</span></div>
        <div><span className="l">24h volume</span><span className="v">{volUsd(t) > 0 ? fmtUsd(volUsd(t)) : "—"}</span></div>
        <div><span className="l">24h trades</span><span className="v">{t.txCount24h ?? 0}</span></div>
        <div><span className="l">Launched</span><span className="v">{t.createdAt ? timeAgo(t.createdAt) : "—"}</span></div>
      </div>

      {meta.description ? <p className="hs-pane-desc">{meta.description}</p> : null}

      <div className="hs-pane-buy">
        <span className="l">Quick buy ({env.nativeSymbol})</span>
        <div className="r">
          {QUICK_BUY_AMOUNTS.map((a) => (
            <button key={a} className="hs-qb-amt big" disabled={busyAmt != null} onClick={() => buy(a)}>
              {busyAmt === a ? "…" : a}
            </button>
          ))}
          <Link to={`/token/${t.address}`} className="hs-pane-trade">Trade</Link>
        </div>
      </div>

      <div className="hs-pane-fees">
        Every trade pays 1%: <b>50% holders · 40% creator · 10% platform</b>
      </div>
    </div>
  );
}
