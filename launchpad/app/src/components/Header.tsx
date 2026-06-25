import { useAccount } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import { CoinMark } from "./Icons";

export type View = "explore" | "detail" | "create" | "presale" | "docs" | "terms";

export function Header({
  view,
  go,
}: {
  view: View;
  go: (v: View) => void;
}) {
  const { address, isConnected } = useAccount();
  const { open } = useAppKit();
  const short = address ? address.slice(0, 6) + "…" + address.slice(-4) : "";

  return (
    <header className="nav wrap">
      <div className="brand" onClick={() => go("explore")}>
        <CoinMark className="mark" size={26} />
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
        <span className={"nav-link" + (view === "presale" ? " active" : "")} onClick={() => go("presale")}>
          Presale
        </span>
        <span className={"nav-link" + (view === "docs" ? " active" : "")} onClick={() => go("docs")}>
          Docs
        </span>
      </nav>
      <span className="spacer" />
      <button className={"wallet-btn" + (isConnected ? " connected" : "")} onClick={() => open()} title={isConnected ? "Account" : "Connect"}>
        {isConnected ? short : "Connect Wallet"}
      </button>
    </header>
  );
}
