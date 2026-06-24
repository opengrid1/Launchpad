export type View = "explore" | "detail" | "create" | "docs" | "terms";

export function Header({
  view,
  go,
}: {
  view: View;
  go: (v: View) => void;
}) {
  return (
    <header className="nav wrap">
      <div className="brand" onClick={() => go("explore")}>
        <svg className="mark" width="20" height="22" viewBox="0 0 20 22" aria-hidden="true">
          <path d="M10 1.5 L18.2 6.2 L18.2 15.8 L10 20.5 L1.8 15.8 L1.8 6.2 Z" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <path d="M10 6.4 L10 15.6 M6 8.7 L14 13.3 M14 8.7 L6 13.3" stroke="currentColor" strokeWidth="0.9" opacity="0.5" />
        </svg>
        <div>
          <div className="word">COINWORKS</div>
          <div className="sub">B20 · BASE</div>
        </div>
      </div>
      <nav className="top-nav">
        <span className={"nav-link" + (view === "explore" || view === "detail" ? " active" : "")} onClick={() => go("explore")}>
          Explore
        </span>
        <span className={"nav-link" + (view === "create" ? " active" : "")} onClick={() => go("create")}>
          Create
        </span>
        <span className={"nav-link" + (view === "docs" ? " active" : "")} onClick={() => go("docs")}>
          Docs
        </span>
      </nav>
      <span className="spacer" />
      <button className="wallet-btn">Connect Wallet</button>
    </header>
  );
}
