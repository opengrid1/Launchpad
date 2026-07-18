/**
 * Quiver default token image — a full-bleed branded tile shown for any token
 * without its own logo (or whose logo fails to load). A designed raster mark: a
 * lime printer printing a rising stock certificate on the walnut panel, exported at 512px
 * so it stays sharp from a 12px list avatar up to a full card. Served from
 * /quiver-default.png (web/public), so it's a plain <img> with no bundle cost.
 */
export function QuiverMark({ className = "" }: { className?: string }) {
  return (
    <img
      src="/printr-default.png"
      alt="stockprintr token"
      loading="lazy"
      className={`h-full w-full object-cover ${className}`}
    />
  );
}
