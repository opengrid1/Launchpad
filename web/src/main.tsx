import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { BRAND, BRAND_FLAVOR } from "./lib/brand";
import "./styles.css";

// index.html ships the default flavor's meta; keep the tab title, description
// and theme scope in sync with the flavor selected at build time (VITE_BRAND).
document.title = BRAND.title;
document.querySelector('meta[name="description"]')?.setAttribute("content", BRAND.description);
// squidpad (ink) and meowstock (meow) share the ink theme scope.
const INK_STYLE = BRAND_FLAVOR === "ink" || BRAND_FLAVOR === "meow";
document.documentElement.dataset.brand = INK_STYLE ? "hyper" : BRAND_FLAVOR;
if (INK_STYLE) document.documentElement.dataset.flavor = "ink";

// hyperstock ships its own mark; the other flavors keep the icons index.html
// declares. Swapped here because all flavors build from one index.html.
if (BRAND_FLAVOR === "hyper" || INK_STYLE) {
  const font = document.createElement("link");
  font.rel = "stylesheet";
  font.href = "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&family=Space+Grotesk:wght@500;600;700&family=Rock+Salt&display=swap";
  document.head.appendChild(font);
  const icon = INK_STYLE ? undefined : "/hyperstock-favicon.png";
  if (icon) {
    document.querySelector('link[rel="icon"][sizes="64x64"]')?.setAttribute("href", icon);
    document.querySelector('link[rel="icon"][sizes="32x32"]')?.setAttribute("href", "/hyperstock-favicon-32.png");
    document.querySelector('link[rel="apple-touch-icon"]')?.setAttribute("href", "/hyperstock-touch.png");
  } else {
    import("./lib/hyper/defaultLogo").then(({ BRAND_MARK }) => {
      document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]').forEach((l) => l.setAttribute("href", BRAND_MARK));
    });
  }
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
