import { useState } from "react";

import { short } from "../lib/format";
import { setToast } from "../lib/hooks";

/** An address you can copy with one tap: short form, full form on hover, a
 *  copy button that confirms. Falls back to selecting the text where the
 *  clipboard is unavailable (some wallet browsers). */
export function Copy({ value, label, full = false }: { value: string; label?: string; full?: boolean }) {
  const [done, setDone] = useState(false);
  const copy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = value; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch { /* nothing else to try */ }
      document.body.removeChild(ta);
    }
    setDone(true);
    setToast({ kind: "ok", text: `${label ?? "Address"} copied` });
    setTimeout(() => setDone(false), 1600);
  };
  return (
    <button type="button" className={"copy " + (done ? "done" : "")} onClick={copy} title={value} aria-label={`Copy ${label ?? "address"}`}>
      <span className="mono">{full ? value : short(value)}</span>
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {done ? <path d="M5 12l5 5L20 7" /> : <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></>}
      </svg>
    </button>
  );
}
