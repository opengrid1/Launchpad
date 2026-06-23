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
        Umbra is a reference implementation. Unaudited, testnet only. Read the code before you trust it.
      </footer>
    </div>
  );
}
