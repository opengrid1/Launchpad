import { useState } from "react";
import { Header } from "./components/Header";
import { Presale } from "./pages/Presale";
import { Pool } from "./pages/Pool";

type Tab = "presale" | "pool";

export function App() {
  const [tab, setTab] = useState<Tab>("presale");
  return (
    <div className="app">
      <Header tab={tab} setTab={setTab} />
      <main className="page">{tab === "presale" ? <Presale /> : <Pool />}</main>
      <footer className="foot">
        <div className="row-links">
          <span>UMBRA</span>
          <span>v0.1.0</span>
          <span>SEPOLIA</span>
        </div>
        Reference implementation. Unaudited, single-party trusted setup, testnet only.
        Read the code before you trust it.
      </footer>
    </div>
  );
}
