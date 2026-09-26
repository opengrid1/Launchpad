import { useEffect, useRef, useState } from "react";

/** A small dropdown in the site's own style, instead of the native picker. */
export function Menu<T extends string>({ value, options, onChange, label }: { value: T; options: { v: T; l: string }[]; onChange: (v: T) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent | TouchEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", off);
    document.addEventListener("touchstart", off);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("touchstart", off); document.removeEventListener("keydown", key); };
  }, [open]);
  const cur = options.find((o) => o.v === value) ?? options[0];
  return (
    <div className={"menu " + (open ? "open" : "")} ref={ref}>
      <button type="button" className="menu-b" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
        {label && <span className="menu-l">{label}</span>}{cur.l}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <ul className="menu-list" role="listbox">
          {options.map((o) => (
            <li key={o.v} role="option" aria-selected={o.v === value} className={o.v === value ? "on" : ""} onClick={() => { onChange(o.v); setOpen(false); }}>
              {o.l}{o.v === value && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12l5 5L20 7" /></svg>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
