import { Link } from "react-router-dom";

import { BRAND } from "../lib/brand";
import { shortAddr } from "../lib/format";
import { useWallet } from "../lib/useWallet";

/**
 * No nav bar here — just the two things that anchor the corners: the brand
 * mark on the left and the wallet on the right. Navigation lives in the
 * floating dock. The asymmetry (identity vs account, corners vs centered
 * dock) is the layout signature.
 */
export function Header() {
  const { address, isConnected, connectFirst, disconnect, isPending } = useWallet();

  return (
    <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-5 sm:px-6">
      <Link to="/" className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-[12px] bg-ink">
          <svg width="19" height="19" viewBox="0 0 64 64" fill="none" aria-hidden>
            <path d="M32 54 L32 13" stroke="#B6FF00" strokeWidth="5" strokeLinecap="round" />
            <path d="M22 22 L32 12 L42 22" stroke="#B6FF00" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M25 47 L32 41 L39 47" stroke="#B6FF00" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M25 40 L32 34 L39 40" stroke="#B6FF00" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="text-[17px] font-semibold tracking-tight text-ink">{BRAND.name}</span>
      </Link>

      {isConnected && address ? (
        <button
          onClick={() => disconnect()}
          className="tnum flex items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
          title="Disconnect"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          <span className="sm:hidden">{`${address.slice(0, 4)}..${address.slice(-3)}`}</span>
          <span className="hidden sm:inline">{shortAddr(address)}</span>
        </button>
      ) : (
        <button
          onClick={connectFirst}
          disabled={isPending}
          className="rounded-full bg-ink px-4 py-2.5 text-sm font-semibold text-white shadow-[var(--shadow-btn)] transition-opacity hover:opacity-90 disabled:opacity-60 sm:px-5"
        >
          {isPending ? "Connecting" : "Connect Wallet"}
        </button>
      )}
    </div>
  );
}
