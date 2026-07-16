import { Link } from "react-router-dom";

import { BRAND } from "../lib/brand";
import { shortAddr } from "../lib/format";
import { useWallet } from "../lib/useWallet";

/**
 * Not a navbar — a quiet brand line. The wordmark is home (Explore); the two
 * actions that matter, Launch and the wallet, sit opposite it. Borderless and
 * airy, it reads as the top of a product, not a dashboard chrome bar.
 */
export function Header() {
  const { address, isConnected, connectFirst, disconnect, isPending } = useWallet();

  return (
    <div className="mx-auto flex max-w-2xl items-center justify-between px-5 pb-1 pt-6">
      <Link to="/" aria-label="Explore" className="flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-[11px] bg-ink">
          <svg width="17" height="17" viewBox="0 0 64 64" fill="none" aria-hidden>
            <path d="M32 54 L32 13" stroke="#B6FF00" strokeWidth="5" strokeLinecap="round" />
            <path d="M22 22 L32 12 L42 22" stroke="#B6FF00" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M25 47 L32 41 L39 47" stroke="#B6FF00" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M25 40 L32 34 L39 40" stroke="#B6FF00" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="text-[18px] font-semibold tracking-tight text-ink">{BRAND.name}</span>
      </Link>

      <div className="flex items-center gap-2">
        <Link
          to="/launch"
          className="rounded-full bg-accent px-4 py-2 text-[13px] font-bold text-black transition-transform hover:scale-[1.03]"
        >
          Launch
        </Link>
        {isConnected && address ? (
          <button
            onClick={() => disconnect()}
            className="tnum flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
            title="Disconnect"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            {`${address.slice(0, 4)}··${address.slice(-3)}`}
          </button>
        ) : (
          <button
            onClick={connectFirst}
            disabled={isPending}
            className="rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {isPending ? "Connecting" : "Connect"}
          </button>
        )}
      </div>
    </div>
  );
}
