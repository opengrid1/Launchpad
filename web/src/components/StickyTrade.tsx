import { useEffect, useState } from "react";
import type { TokenSummary } from "@launchpad/sdk";

import { TradePanel } from "./TradePanel";

/**
 * Trade surface that adapts to screen size:
 *  - desktop (lg+): the panel sits inline in the page's sticky sidebar column.
 *  - mobile: a fixed Buy/Sell bar pinned above the bottom nav; tapping either
 *    side drops the full panel down (up) as a sheet, pre-set to that side.
 */
export function StickyTrade({ token }: { token: TokenSummary }) {
  const [open, setOpen] = useState(false);

  // Lock body scroll while the mobile sheet is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      {/* Desktop: inline sticky panel */}
      <div className="hidden lg:block">
        <TradePanel token={token} />
      </div>

      {/* Mobile: fixed Buy/Sell trigger bar above the bottom nav */}
      <div className="fixed inset-x-0 bottom-[58px] z-40 border-t border-edge bg-bg/92 px-3 py-2.5 backdrop-blur-md lg:hidden">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-2">
          <button
            onClick={() => setOpen(true)}
            className="hud-cut h-11 bg-up text-[14px] font-bold uppercase tracking-wide text-black shadow-[0_0_22px_-8px_var(--color-up)] transition-[filter] hover:brightness-110"
          >
            Buy
          </button>
          <button
            onClick={() => setOpen(true)}
            className="hud-cut h-11 bg-down text-[14px] font-bold uppercase tracking-wide text-black shadow-[0_0_22px_-8px_var(--color-down)] transition-[filter] hover:brightness-105"
          >
            Sell
          </button>
        </div>
      </div>

      {/* Mobile: the dropdown sheet */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <button
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <div className="sheet-in absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-edge bg-panel p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-edge-2" />
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
                Trade {token.symbol}
              </span>
              <button
                onClick={() => setOpen(false)}
                className="text-[12px] font-semibold text-ink-2 transition-colors hover:text-ink"
              >
                Close
              </button>
            </div>
            <TradePanel token={token} />
          </div>
        </div>
      )}
    </>
  );
}
