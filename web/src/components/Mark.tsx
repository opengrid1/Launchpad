/**
 * Token mark: a typographic monogram from the ticker, set in mono on a
 * recessed tile like a stamp. No emoji and no fake uploaded logos — the
 * ticker is the only identity an offering actually has at issuance.
 */
export function Mark({ ticker, size = 40 }: { ticker: string; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-[5px] bg-paper-2 font-mono font-semibold uppercase text-ink ring-1 ring-rule-2"
      style={{ width: size, height: size, fontSize: size * 0.34 }}
      aria-hidden="true"
    >
      {ticker.slice(0, 2)}
    </span>
  )
}
