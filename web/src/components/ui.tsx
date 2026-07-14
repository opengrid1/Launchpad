import { type ReactNode } from "react";

import { explorerTx } from "../lib/format";
import { useUi } from "../store";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-edge bg-panel ${className}`}>{children}</div>
  );
}

export function CardHeader({ title, right }: { title: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-edge px-4 py-3">
      <h3 className="text-sm font-semibold tracking-wide text-ink">{title}</h3>
      {right}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "up" | "down" | "accent" | "amber";
}) {
  const tones: Record<string, string> = {
    neutral: "bg-panel-2 text-ink-2 border-edge",
    up: "bg-up/10 text-up border-up/30",
    down: "bg-down/10 text-down border-down/30",
    accent: "bg-accent/10 text-accent-2 border-accent/30",
    amber: "bg-amber/10 text-amber border-amber/30",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-4 ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Button({
  children,
  onClick,
  disabled,
  variant = "primary",
  className = "",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost" | "buy" | "sell" | "danger";
  className?: string;
  type?: "button" | "submit";
}) {
  const variants: Record<string, string> = {
    primary:
      "bg-accent text-white hover:bg-accent-2 disabled:bg-panel-2 disabled:text-ink-3",
    ghost:
      "bg-transparent border border-edge-2 text-ink-2 hover:text-ink hover:border-ink-3 disabled:text-ink-3",
    buy: "bg-up text-white hover:brightness-110 disabled:bg-panel-2 disabled:text-ink-3",
    sell: "bg-down text-white hover:brightness-110 disabled:bg-panel-2 disabled:text-ink-3",
    danger: "bg-down/15 border border-down/40 text-down hover:bg-down/25 disabled:opacity-50",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="whitespace-nowrap text-xs font-medium uppercase tracking-wider text-ink-2">
          {label}
        </span>
        {hint ? <span className="truncate text-xs text-ink-3">{hint}</span> : null}
      </div>
      {children}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-edge-2 bg-panel-2 px-3 py-2 text-sm text-ink placeholder:text-ink-3 outline-none focus:border-accent transition-colors";

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-panel-2 ${className}`} />;
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <p className="text-sm font-medium text-ink-2">{title}</p>
      {body ? <p className="mt-1 max-w-sm text-xs text-ink-3">{body}</p> : null}
    </div>
  );
}

export function Toasts() {
  const { toasts, dismissToast } = useUi();
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast-enter rounded-xl border p-3 shadow-xl backdrop-blur ${
            t.kind === "error"
              ? "border-down/40 bg-panel/95"
              : t.kind === "success"
                ? "border-up/40 bg-panel/95"
                : "border-edge-2 bg-panel/95"
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-ink">{t.title}</p>
            <button
              onClick={() => dismissToast(t.id)}
              className="text-ink-3 hover:text-ink"
              aria-label="Dismiss"
            >
              &times;
            </button>
          </div>
          {t.body ? <p className="mt-1 break-words text-xs text-ink-2">{t.body}</p> : null}
          {t.txHash && explorerTx(t.txHash) ? (
            <a
              href={explorerTx(t.txHash)!}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block text-xs text-accent-2 hover:underline"
            >
              View transaction
            </a>
          ) : null}
        </div>
      ))}
    </div>
  );
}
