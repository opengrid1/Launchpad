import { useState } from "react";
import { Link } from "react-router-dom";
import { FEATURES, STATS, TOKENS } from "../lib/data";
import { fmtNum, fmtPct, fmtUsd } from "../lib/format";
import { AnimatedNumber } from "../components/AnimatedNumber";
import { Sparkline } from "../components/charts";
import { Icon } from "../components/Icon";
import { TokenIcon } from "../components/TokenIcon";
import { Reveal } from "../components/ui";
import { WalletModal } from "../components/wallet";
import { Footer } from "../components/Footer";
import { useApp } from "../lib/store";

const HERO_STATS = [
  { label: "Total value settled", value: STATS.totalValueSettled, fmt: (v: number) => fmtUsd(v, { compact: true }) },
  { label: "Transactions processed", value: STATS.transactions, fmt: (v: number) => fmtNum(v, 1) },
  { label: "Connected networks", value: STATS.networks, fmt: (v: number) => Math.round(v).toString() },
  { label: "Median network fee", value: STATS.medianFee, fmt: (v: number) => `$${v.toFixed(4)}` },
];

export function Landing() {
  const { wallet } = useApp();
  const [walletOpen, setWalletOpen] = useState(false);
  const spotlight = TOKENS.slice(0, 6);

  return (
    <div style={{ paddingTop: "var(--nav-h)" }} id="top">
      {/* Hero ------------------------------------------------------------- */}
      <section style={{ position: "relative", padding: "110px 0 80px", overflow: "hidden" }}>
        <div className="glow-field">
          <div className="glow emerald" style={{ width: 640, height: 640, top: -260, left: "50%", transform: "translateX(-50%)" }} />
          <div className="glow cyan" style={{ width: 480, height: 480, top: 60, right: -180 }} />
          <div className="glow deep" style={{ width: 420, height: 420, top: 180, left: -160 }} />
          <div className="grid-lines" />
        </div>

        <div className="container" style={{ position: "relative", zIndex: 1, textAlign: "center" }}>
          <Reveal>
            <span className="badge accent" style={{ height: 30, padding: "0 14px" }}>
              <span className="pulse-dot" />
              Meridian One mainnet is live
            </span>
          </Reveal>
          <Reveal delay={80}>
            <h1 className="display" style={{ margin: "26px auto 0", maxWidth: 820 }}>
              Move value with
              <br />
              <span className="gradient-text">absolute clarity</span>
            </h1>
          </Reveal>
          <Reveal delay={160}>
            <p className="sub" style={{ margin: "24px auto 0", maxWidth: 560 }}>
              One balance across every chain. Sub-second settlement, deep native
              liquidity and institutional-grade pricing — in an interface that
              stays out of your way.
            </p>
          </Reveal>
          <Reveal delay={240}>
            <div className="row gap-3" style={{ justifyContent: "center", marginTop: 36, flexWrap: "wrap" }}>
              {wallet ? (
                <Link to="/dashboard" className="btn btn-primary btn-lg">
                  Open dashboard
                  <Icon name="send" size={18} />
                </Link>
              ) : (
                <button className="btn btn-primary btn-lg" onClick={() => setWalletOpen(true)}>
                  <Icon name="wallet" size={18} />
                  Connect wallet
                </button>
              )}
              <Link to="/markets" className="btn btn-ghost btn-lg">
                Explore markets
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Stats band ------------------------------------------------------- */}
      <section className="container" style={{ position: "relative", zIndex: 1 }}>
        <Reveal>
          <div className="card" style={{ padding: 0 }}>
            <div className="grid-4" style={{ gap: 0 }}>
              {HERO_STATS.map((s, i) => (
                <div
                  key={s.label}
                  style={{
                    padding: "30px 28px",
                    borderLeft: i > 0 ? "1px solid var(--border)" : "none",
                  }}
                  className="stat-cell"
                >
                  <div style={{ fontSize: "1.9rem", fontWeight: 800, letterSpacing: "-0.03em" }}>
                    <AnimatedNumber value={s.value} format={s.fmt} duration={1400} />
                  </div>
                  <div className="muted" style={{ marginTop: 4, fontSize: "0.88rem" }}>
                    {s.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </section>

      {/* Markets spotlight ------------------------------------------------ */}
      <section className="container" style={{ marginTop: 120 }}>
        <Reveal>
          <div className="row between wrap" style={{ gap: 16, marginBottom: 28 }}>
            <div>
              <span className="eyebrow">Markets</span>
              <h2 className="h2" style={{ marginTop: 10 }}>Live across every major asset</h2>
            </div>
            <Link to="/markets" className="btn btn-soft btn-sm">
              View all markets
              <Icon name="send" size={15} />
            </Link>
          </div>
        </Reveal>
        <div className="grid-3">
          {spotlight.map((t, i) => (
            <Reveal key={t.symbol} delay={i * 60}>
              <Link to={`/token/${t.symbol}`}>
                <div className="card hover">
                  <div className="row between">
                    <div className="row gap-3">
                      <TokenIcon token={t} />
                      <div>
                        <div style={{ fontWeight: 600 }}>{t.name}</div>
                        <div className="faint" style={{ fontSize: "0.82rem" }}>{t.symbol}</div>
                      </div>
                    </div>
                    <span className={`badge ${t.change24h >= 0 ? "up" : "down"}`}>
                      {fmtPct(t.change24h)}
                    </span>
                  </div>
                  <div className="row between" style={{ marginTop: 22, alignItems: "flex-end" }}>
                    <div className="tnum" style={{ fontSize: "1.45rem", fontWeight: 700 }}>
                      {fmtUsd(t.price)}
                    </div>
                    <Sparkline data={t.series} positive={t.change24h >= 0} />
                  </div>
                </div>
              </Link>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Features --------------------------------------------------------- */}
      <section className="container" style={{ marginTop: 130 }}>
        <Reveal>
          <div style={{ textAlign: "center", maxWidth: 640, margin: "0 auto 48px" }}>
            <span className="eyebrow">Why Meridian</span>
            <h2 className="h2" style={{ marginTop: 10 }}>
              Everything a settlement layer should be
            </h2>
            <p className="sub" style={{ marginTop: 16 }}>
              Built from first principles for speed, safety and simplicity — with
              nothing between you and your assets.
            </p>
          </div>
        </Reveal>
        <div className="grid-3">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={(i % 3) * 70}>
              <div className="card hover" style={{ minHeight: 210 }}>
                <span
                  style={{
                    display: "inline-flex",
                    padding: 11,
                    borderRadius: "var(--r-md)",
                    background: "var(--accent-soft)",
                    color: "var(--accent)",
                    border: "1px solid rgba(61,232,176,0.2)",
                  }}
                >
                  <Icon name={f.icon} size={21} />
                </span>
                <h3 className="h3" style={{ marginTop: 18 }}>{f.title}</h3>
                <p className="muted" style={{ marginTop: 10, fontSize: "0.94rem", lineHeight: 1.65 }}>
                  {f.body}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Security strip --------------------------------------------------- */}
      <section className="container" style={{ marginTop: 130 }}>
        <Reveal>
          <div
            className="card"
            style={{
              position: "relative",
              overflow: "hidden",
              padding: "60px 48px",
              textAlign: "center",
            }}
          >
            <div className="glow-field">
              <div className="glow emerald" style={{ width: 520, height: 520, bottom: -340, left: "50%", transform: "translateX(-50%)", opacity: 0.35 }} />
            </div>
            <div style={{ position: "relative", zIndex: 1 }}>
              <span className="eyebrow" style={{ justifyContent: "center" }}>
                <Icon name="shield" size={15} />
                Self-custody, always
              </span>
              <h2 className="h2" style={{ margin: "14px auto 0", maxWidth: 560 }}>
                Your keys never leave your device
              </h2>
              <p className="sub" style={{ margin: "16px auto 0", maxWidth: 520 }}>
                Every route is simulated before you sign, every contract is
                audited and open source, and nothing moves without your explicit
                approval.
              </p>
              <div className="row gap-3" style={{ justifyContent: "center", marginTop: 30, flexWrap: "wrap" }}>
                <span className="badge">4 independent audits</span>
                <span className="badge">$2M bug bounty</span>
                <span className="badge">100% open source</span>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* Final CTA -------------------------------------------------------- */}
      <section className="container" style={{ margin: "130px auto 40px", textAlign: "center" }}>
        <Reveal>
          <h2 className="h2">Ready when you are</h2>
          <p className="sub" style={{ margin: "14px auto 0", maxWidth: 440 }}>
            Connect a wallet and see your entire on-chain portfolio in one calm,
            fast view.
          </p>
          <div className="row" style={{ justifyContent: "center", marginTop: 28 }}>
            {wallet ? (
              <Link to="/dashboard" className="btn btn-primary btn-lg">Open dashboard</Link>
            ) : (
              <button className="btn btn-primary btn-lg" onClick={() => setWalletOpen(true)}>
                Get started
              </button>
            )}
          </div>
        </Reveal>
      </section>

      <Footer />
      <WalletModal open={walletOpen} onClose={() => setWalletOpen(false)} />
    </div>
  );
}
