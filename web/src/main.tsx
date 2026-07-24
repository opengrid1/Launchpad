import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { BRAND } from "./lib/brand";
import "./styles.css";

// index.html ships the default flavor's meta; keep the tab title and
// description in sync with the flavor selected at build time (VITE_BRAND).
document.title = BRAND.title;
document.querySelector('meta[name="description"]')?.setAttribute("content", BRAND.description);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
