import { useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";
const KEY = "alicorn.theme";

function read(): Theme {
  try { const v = localStorage.getItem(KEY); if (v === "light" || v === "dark") return v; } catch { /* private mode */ }
  return "system";
}
function apply(t: Theme) {
  const root = document.documentElement;
  if (t === "system") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", t);
}
apply(read());

/** The viewer's theme choice: light, dark, or follow the system. */
export function useTheme(): [Theme, boolean, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(read);
  const [sysDark, setSysDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => setSysDark(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const set = (t: Theme) => { setTheme(t); apply(t); try { if (t === "system") localStorage.removeItem(KEY); else localStorage.setItem(KEY, t); } catch { /* ignore */ } };
  const isDark = theme === "dark" || (theme === "system" && sysDark);
  return [theme, isDark, set];
}
