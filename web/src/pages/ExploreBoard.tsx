import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTokens } from "@launchpad/sdk/react";
import type { TokenSummary } from "@launchpad/sdk";

import { Icon } from "../components/Icon";
import { QuiverMark } from "../components/QuiverMark";
import { client } from "../lib/client";
import { env } from "../lib/env";
import { fmtUsd, shortAddr, timeAgo, usdRateOf } from "../lib/format";
import { isHidden } from "../lib/hiddenTokens";
import { isOfficial } from "../lib/official";
import { OFFICIAL_LOGOS } from "../lib/officialLogos";

type Sort = "new" | "volume" | "mcap";
const SORTS: { id: Sort; label: string }[] = [
  { id: "new", label: "Newest" },
  { id: "volume", label: "Volume" },
  { id: "mcap", label: "Market cap" },
];

/**
 * The copair flight deck: an editorial hero with the freshest market as a
 * boarding card, a slim stats rail, then a refined market grid. Calm ground,
 * one green accent, price and rewards as the heroes.
 */
export function ExploreBoard() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sort, setSort] = useState<Sort>("new");
  const { data: byVolume, loading: lv } = useTokens(client, { sort: "volume", limit: 80 });
  const { data: byNew, loading: ln } = useTokens(client, { sort: "new", limit: 80 });

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query.trim().toLowerCase()), 130);
    return () => window.clearTimeout(id);
  }, [query]);

  const all = useMemo(() => {
    if (env.hideTokens) return [] as TokenSummary[];
    const seen = new Map<string, TokenSummary>();
    for (const t of [...(byVolume ?? []), ...(byNew ?? [])]) {
      if (!isHidden(t.address)) seen.set(t.address.toLowerCase(), t);
    }
    return [...seen.values()];
  }, [byVolume, byNew]);

  const feed = useMemo(() => {
    let list = all;
    if (debounced) {
      list = all.filter(
        (t) =>
          t.name.toLowerCase().includes(debounced) ||
          t.symbol.toLowerCase().includes(debounced) ||
          t.address.toLowerCase() === debounced,
      );
    }
    const s = [...list];
    if (sort === "volume") s.sort((a, b) => Number(b.volumeTotalWei) - Number(a.volumeTotalWei));
    else if (sort === "mcap") s.sort((a, b) => Number(b.marketCapUsd) - Number(a.marketCapUsd));
    else s.sort((a, b) => b.createdAt - a.createdAt);
    return s;
  }, [all, debounced, sort]);

  const newest = useMemo(() => [...all].sort((a, b) => b.createdAt - a.createdAt).slice(0, 14), [all]);
  // Volumes are recorded in each coin's pair token, so convert per token to
  // dollars before summing; a raw sum would mix NVDA with PONS with ETH.
  const dayVolumeUsd = useMemo(
    () => all.reduce((a, t) => a + (Number(t.volume24hWei || "0") / 1e18) * usdRateOf(t), 0),
    [all],
  );
  const loading = !env.hideTokens && (lv || ln) && all.length === 0;
  const spotlight = newest[0];

  return (
    <div className="board mx-auto max-w-6xl px-4 pb-24 pt-4 sm:px-6">
      {/* HERO: editorial copy + the freshest market as a boarding card */}
      {!debounced && (
        <>
          <section className="cp-hero">
            <div className="cp-hero-copy">
              <p className="cp-eyebrow">
                <span className="board-dot" /> live on {env.chainName} · pair &amp; earn
              </p>
              <h1 className="cp-headline">
                Every trade.
                <br />
                <em>Holders get paid.</em>
              </h1>
              <p className="cp-sub">
                Pair a coin with any tokenized stock, meme, or ETH. 80% of every trade fee is paid
                to holders in that pair token, delivered automatically. Creators keep 20%.
              </p>
              <div className="cp-chips">
                <span><b>80%</b> to holders</span>
                <span>pair <b>any token</b></span>
                <span><b>auto</b> payouts</span>
                <span>liquidity <b>locked</b></span>
              </div>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <Link to="/launch" className="cp-cta">Launch a coin</Link>
                <Link to="/docs" className="cp-cta-ghost">How it works</Link>
              </div>
              <div className="cp-stats">
                <div><b>{all.length}</b><span>markets</span></div>
                <i />
                <div><b>{fmtUsd(dayVolumeUsd)}</b><span>24h volume</span></div>
                <i />
                <div><b>{spotlight ? `$${spotlight.symbol}` : "-"}</b><span>latest launch</span></div>
              </div>
            </div>
            {spotlight ? <HeroCard t={spotlight} /> : loading ? <div className="cp-herocard cp-skel" /> : null}
          </section>
          <ContractStrip />
        </>
      )}

      {/* Live activity ticker */}
      {newest.length > 0 && <div className="mt-6"><Ticker tokens={newest} /></div>}

      {/* Search + sort */}
      <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <span className="cp-rail" />
          <h2 className="text-[13px] font-bold uppercase tracking-[0.14em] text-ink-2">
            {debounced ? "Results" : sort === "new" ? "Fresh launches" : sort === "volume" ? "Most traded" : "Top market cap"}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <label className="relative block sm:w-64">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3">
              <Icon name="search" size={15} />
            </span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, ticker or address"
              type="search"
              className="board-input h-9 w-full pl-9 pr-3 text-[13px] outline-none"
            />
          </label>
          <div className="board-tabs">
            {SORTS.map((s) => (
              <button key={s.id} onClick={() => setSort(s.id)} className={sort === s.id ? "on" : ""}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Market grid */}
      <div className="mt-4">
        {loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {[...Array(8)].map((_, i) => <BoardSkeleton key={i} />)}
          </div>
        ) : feed.length === 0 ? (
          <BoardEmpty q={debounced} />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {feed.map((t, i) => <BoardCard key={t.address} t={t} fresh={!debounced && sort === "new" && i === 0} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function logoSrc(t: TokenSummary): string | null {
  const logo = OFFICIAL_LOGOS[t.address.toLowerCase()] ?? t.metadata?.logo;
  if (!logo || !/^(https?:|ipfs:|data:)/.test(String(logo))) return null;
  return String(logo).startsWith("ipfs://") ? `https://ipfs.io/ipfs/${String(logo).slice(7)}` : String(logo);
}

function pairSymOf(t: TokenSummary): string {
  const s = (t.metadata as any)?.pair?.symbol ?? (t.metadata as any)?.rewardStockSymbol;
  return typeof s === "string" && s ? s : "";
}

/** The freshest market, styled like a boarding card. */
function HeroCard({ t }: { t: TokenSummary }) {
  const [bad, setBad] = useState(false);
  const src = logoSrc(t);
  const vol = fmtUsd((Number(t.volumeTotalWei) / 1e18) * usdRateOf(t));
  const pairSym = pairSymOf(t);
  return (
    <Link to={`/token/${t.address}`} className="cp-herocard cp-frame">
      <i className="cp-corners" aria-hidden />
      <div className="cp-herocard-art">
        {src && !bad ? <img src={src} alt="" onError={() => setBad(true)} /> : <QuiverMark />}
        <span className="cp-herocard-badges">
          <span className="board-fresh">NEW</span>
          {isOfficial(t.address) && <span className="board-official">OFFICIAL</span>}
        </span>
      </div>
      <div className="cp-herocard-body">
        <div className="min-w-0">
          <p className="truncate text-[16.5px] font-extrabold leading-tight text-ink">
            {t.name} <span className="mono text-[12.5px] font-bold text-accent-ink">${t.symbol}</span>
          </p>
          <p className="mono mt-0.5 text-[11px] text-ink-3">by {shortAddr(t.creator)} · {timeAgo(t.createdAt).replace(" ago", "")}</p>
        </div>
        <div className="cp-herocard-figures">
          <div>
            <span>Market cap</span>
            <b className="mono">{fmtUsd(t.marketCapUsd)}</b>
          </div>
          <div>
            <span>Volume</span>
            <b className="mono">{vol}</b>
          </div>
          {pairSym && (
            <div>
              <span>Holders earn</span>
              <b>{pairSym}</b>
            </div>
          )}
        </div>
        <span className="cp-cta mt-1 w-full text-center">Trade {`$${t.symbol}`}</span>
      </div>
    </Link>
  );
}

/** The official $COPAIR contract, framed like a target card. */
function ContractStrip() {
  const [copied, setCopied] = useState(false);
  const addr = "0xB9B9BfcABA4A1dc55724AD8958bCE3D36c104663";
  const copy = () => {
    navigator.clipboard?.writeText(addr).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  };
  return (
    <div className="cp-contract cp-frame">
      <i className="cp-corners" aria-hidden />
      <span className="lbl">$COPAIR contract</span>
      <span className="addr flex-1">{addr}</span>
      <button onClick={copy}>{copied ? "Copied" : "Copy"}</button>
      <Link to={`/token/${addr}`} className="cp-cta" style={{ padding: "8px 18px", fontSize: 13 }}>
        Trade
      </Link>
    </div>
  );
}

function Ticker({ tokens }: { tokens: TokenSummary[] }) {
  // Duplicate the list so the marquee loops seamlessly.
  const row = [...tokens, ...tokens];
  return (
    <div className="board-ticker">
      <span className="board-ticker-label">JUST LAUNCHED</span>
      <div className="board-ticker-track">
        <div className="board-ticker-run">
          {row.map((t, i) => (
            <Link key={t.address + i} to={`/token/${t.address}`} className="board-ticker-item">
              <TickerLogo t={t} />
              <span className="font-bold text-ink">{t.symbol}</span>
              <span className="mono text-accent-ink">{fmtUsd(t.marketCapUsd)}</span>
              <span className="text-ink-3">{timeAgo(t.createdAt).replace(" ago", "")}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function TickerLogo({ t }: { t: TokenSummary }) {
  const [bad, setBad] = useState(false);
  const src = logoSrc(t);
  return (
    <span className="grid h-5 w-5 place-items-center overflow-hidden rounded-full bg-panel-2">
      {src && !bad ? (
        <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" onError={() => setBad(true)} />
      ) : (
        <QuiverMark />
      )}
    </span>
  );
}

function BoardCard({ t, fresh }: { t: TokenSummary; fresh?: boolean }) {
  const [bad, setBad] = useState(false);
  const src = logoSrc(t);
  const age = timeAgo(t.createdAt).replace(" ago", "");
  const pairSym = pairSymOf(t);
  return (
    <Link to={`/token/${t.address}`} className={`board-card ${fresh ? "is-fresh" : ""}`}>
      <div className="relative aspect-square w-full overflow-hidden bg-panel-2">
        {src && !bad ? (
          <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" onError={() => setBad(true)} />
        ) : (
          <QuiverMark />
        )}
        <span className="board-age">{age}</span>
        {fresh && <span className="board-fresh board-fresh-abs">NEW</span>}
        {isOfficial(t.address) && <span className="board-official board-official-abs">OFFICIAL</span>}
        {pairSym && <span className="cp-earns">earns {pairSym}</span>}
      </div>
      <div className="p-3">
        <div className="flex items-baseline gap-1.5">
          <p className="min-w-0 truncate text-[13px] font-bold leading-tight text-ink">{t.name}</p>
          <span className="mono shrink-0 text-[10.5px] font-semibold text-accent-ink">${t.symbol}</span>
        </div>
        <div className="mt-2.5 flex items-end justify-between">
          <div>
            <p className="text-[9px] uppercase tracking-wide text-ink-3">Mcap</p>
            <p className="mono text-[14px] font-extrabold leading-tight text-accent-ink">{fmtUsd(t.marketCapUsd)}</p>
          </div>
          <div className="text-right">
            <p className="text-[9px] uppercase tracking-wide text-ink-3">Vol</p>
            <p className="mono text-[11.5px] font-semibold leading-tight text-ink-2">
              {fmtUsd((Number(t.volumeTotalWei) / 1e18) * usdRateOf(t))}
            </p>
          </div>
        </div>
      </div>
    </Link>
  );
}

function BoardSkeleton() {
  return (
    <div className="board-card">
      <div className="aspect-square w-full animate-pulse bg-panel-2" />
      <div className="space-y-2 p-3">
        <div className="h-3 w-16 animate-pulse rounded bg-panel-2" />
        <div className="h-4 w-20 animate-pulse rounded bg-panel-2" />
      </div>
    </div>
  );
}

function BoardEmpty({ q }: { q: string }) {
  return (
    <div className="flex flex-col items-center px-6 py-20 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-full bg-accent/10 text-accent-ink">
        <Icon name={q ? "search" : "launch"} size={26} />
      </span>
      <p className="mt-4 text-[18px] font-extrabold text-ink">
        {q ? `No token for "${q}"` : "No launches yet"}
      </p>
      <p className="mt-1.5 max-w-sm text-[13.5px] leading-relaxed text-ink-2">
        {q ? "Try another name, ticker or address." : "Be the first to launch. Holders earn 80% of every trade fee in the paired token, forever."}
      </p>
      {!q && (
        <Link to="/launch" className="board-launch mt-5 !px-5 !py-2.5 !text-[14px]">
          Launch the first token
        </Link>
      )}
    </div>
  );
}
