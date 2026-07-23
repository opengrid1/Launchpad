import { Link } from "react-router-dom";
import { Logo } from "./Logo";
import { NetworkBadge } from "./wallet";

const COLUMNS: Array<{ title: string; links: Array<{ label: string; to?: string }> }> = [
  {
    title: "Product",
    links: [
      { label: "Dashboard", to: "/dashboard" },
      { label: "Markets", to: "/markets" },
      { label: "Activity", to: "/activity" },
      { label: "Settings", to: "/settings" },
    ],
  },
  {
    title: "Developers",
    links: [{ label: "Documentation" }, { label: "API reference" }, { label: "Network status" }, { label: "Bug bounty" }],
  },
  {
    title: "Company",
    links: [{ label: "About" }, { label: "Careers" }, { label: "Press" }, { label: "Contact" }],
  },
  {
    title: "Legal",
    links: [{ label: "Terms of use" }, { label: "Privacy" }, { label: "Disclosures" }],
  },
];

export function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(220px, 1.4fr) repeat(4, minmax(130px, 1fr))",
            gap: 32,
          }}
          className="footer-grid"
        >
          <div>
            <Logo />
            <p className="muted" style={{ marginTop: 14, maxWidth: 260, fontSize: "0.92rem" }}>
              The clearest way to hold, move and settle value on-chain.
            </p>
            <div style={{ marginTop: 18 }}>
              <NetworkBadge />
            </div>
          </div>
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <div className="card-title" style={{ marginBottom: 14 }}>{col.title}</div>
              <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
                {col.links.map((l) => (
                  <li key={l.label}>
                    {l.to ? <Link to={l.to}>{l.label}</Link> : <a href="#top">{l.label}</a>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <hr className="divider" style={{ margin: "48px 0 24px" }} />
        <div className="row between wrap" style={{ gap: 12 }}>
          <span className="faint" style={{ fontSize: "0.84rem" }}>
            © {new Date().getFullYear()} Meridian Labs. Demo interface — not financial advice.
          </span>
          <span className="faint" style={{ fontSize: "0.84rem" }}>
            Built for speed. Designed for trust.
          </span>
        </div>
      </div>
    </footer>
  );
}
