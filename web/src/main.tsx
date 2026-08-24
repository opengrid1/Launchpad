import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { BRAND, BRAND_FLAVOR } from "./lib/brand";
import "./styles.css";

// index.html ships the default flavor's meta; keep the tab title, description
// and theme scope in sync with the flavor selected at build time (VITE_BRAND).
document.title = BRAND.title;
document.querySelector('meta[name="description"]')?.setAttribute("content", BRAND.description);
document.documentElement.dataset.brand = BRAND_FLAVOR;

// liquidstock ships its own mark; the other flavors keep the icons index.html
// declares. Swapped here because all flavors build from one index.html.
if (BRAND_FLAVOR === "hyper") {
  document.querySelector('link[rel="icon"][sizes="64x64"]')?.setAttribute("href", "/liquidstock-favicon.png");
  document.querySelector('link[rel="icon"][sizes="32x32"]')?.setAttribute("href", "/liquidstock-favicon-32.png");
  document.querySelector('link[rel="apple-touch-icon"]')?.setAttribute("href", "/liquidstock-touch.png");
}

// After a redeploy, a stale tab can request lazy chunks that no longer exist
// (hashed filenames changed) and blank out. Vite signals that as
// vite:preloadError; reload once to pick up the fresh build.
window.addEventListener("vite:preloadError", (e) => {
  e.preventDefault();
  const KEY = "steady:reloaded-for-chunk";
  if (!sessionStorage.getItem(KEY)) {
    sessionStorage.setItem(KEY, "1");
    window.location.reload();
  }
});
window.addEventListener("load", () => sessionStorage.removeItem("steady:reloaded-for-chunk"));

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
