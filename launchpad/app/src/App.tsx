import { useState } from "react";
import { Header, type View } from "./components/Header";
import { Explore } from "./pages/Explore";
import { LaunchDetail } from "./pages/LaunchDetail";
import { Create } from "./pages/Create";
import type { Launch } from "./data/launches";

export function App() {
  const [view, setView] = useState<View>("explore");
  const [active, setActive] = useState<Launch | null>(null);

  function go(v: View) {
    if (v === "explore") setActive(null);
    setView(v);
  }

  return (
    <>
      <Header view={view} go={go} />
      {view === "explore" && (
        <Explore
          open={(l) => {
            setActive(l);
            setView("detail");
          }}
          create={() => setView("create")}
        />
      )}
      {view === "detail" && active && <LaunchDetail launch={active} back={() => go("explore")} />}
      {view === "create" && <Create back={() => go("explore")} />}

      <footer className="foot wrap">
        <div className="row-links">
          <span>UMBRA LAUNCHPAD</span>
          <span>B20</span>
          <span>BASE</span>
        </div>
        Fixed-price fair launches on Base. Reference UI, unaudited, testnet preview. Do your own
        research before contributing to any launch.
      </footer>
    </>
  );
}
