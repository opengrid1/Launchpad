import { useState } from "react";

import { short } from "../lib/format";
import { setToast } from "../lib/hooks";
import { Icon } from "./Icon";

/** An address with a copy button. Falls back to a hidden textarea where the clipboard is unavailable. */
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
    <span className="cp">
      <span className="num">{full ? value : short(value)}</span>
      <button type="button" className={"copy " + (done ? "done" : "")} onClick={copy} title={value} aria-label={`Copy ${label ?? "address"}`}>
        <Icon name={done ? "check" : "copy"} size={14} />
      </button>
    </span>
  );
}
