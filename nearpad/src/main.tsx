import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@near-wallet-selector/modal-ui/styles.css";

import App from "./App";
import "./styles.css";

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5_000 } } });

// A tab left open keeps running the script it loaded. When a newer build is
// live, reload so the fix reaches the tab without the user clearing caches.
const myScript = (document.querySelector('script[type="module"][src]') as HTMLScriptElement | null)?.getAttribute("src") ?? "";
async function reloadIfStale() {
  if (!myScript || !navigator.onLine) return;
  try {
    const html = await (await fetch(`/?ts=${Date.now()}`, { cache: "no-store" })).text();
    const live = html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/)?.[1];
    if (live && live !== myScript) location.reload();
  } catch { /* offline or blocked; try again next time */ }
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reloadIfStale(); });
setTimeout(reloadIfStale, 15_000);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
