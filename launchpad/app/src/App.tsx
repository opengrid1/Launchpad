import { useState } from "react";
import { Header, type View } from "./components/Header";
import { Footer } from "./components/Footer";
import { Explore } from "./pages/Explore";
import { LaunchDetail } from "./pages/LaunchDetail";
import { Create } from "./pages/Create";
import { Presale } from "./pages/Presale";
import { Docs } from "./pages/Docs";
import { Terms } from "./pages/Terms";
import type { Launch } from "./data/launches";

export function App() {
  const [view, setView] = useState<View>("explore");
  const [active, setActive] = useState<Launch | null>(null);
  const [anchor, setAnchor] = useState<string | undefined>(undefined);

  function go(v: View, a?: string) {
    setAnchor(a);
    if (v === "explore") setActive(null);
    setView(v);
    if (!a) window.scrollTo(0, 0);
  }

  return (
    <>
      <Header view={view} go={go} />
      {view === "explore" && (
        <Explore open={(l) => { setActive(l); setView("detail"); window.scrollTo(0, 0); }} />
      )}
      {view === "detail" && active && <LaunchDetail launch={active} />}
      {view === "create" && <Create />}
      {view === "presale" && <Presale />}
      {view === "docs" && <Docs anchor={anchor} />}
      {view === "terms" && <Terms anchor={anchor} />}
      <Footer go={go} />
    </>
  );
}
