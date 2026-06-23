import { useState } from "react";
import { parseEther } from "viem";
import type { SaleState } from "./usePresale";

// Self-contained demo so the live site shows a working presale before the
// contracts are deployed to a public testnet. Clearly labelled in the UI as
// sample data; the buy/claim/finalize buttons mutate local state so the flow is
// fully clickable. Swap in real addresses (src/lib/config.ts) and usePresale
// uses the chain instead of this.
function initialSale(): SaleState {
  const now = BigInt(Math.floor(Date.now() / 1000));
  return {
    price: parseEther("0.0001"),
    tokensForSale: parseEther("10000000"),
    softCap: parseEther("1"),
    hardCap: parseEther("100"),
    startTime: now - 3600n,
    endTime: now + 5n * 86400n,
    totalRaised: parseEther("32.4"),
    tokensSold: parseEther("324000"),
    finalized: false,
    succeeded: false,
    perWalletCap: 0n,
  };
}

export function useDemoPresale() {
  const [sale, setSale] = useState<SaleState>(initialSale);
  const [mine, setMine] = useState({ contributed: 0n, owed: 0n });
  const [confirmed, setConfirmed] = useState(false);

  function flash() {
    setConfirmed(true);
    setTimeout(() => setConfirmed(false), 1800);
  }

  function tokensFor(weiIn: bigint) {
    return (weiIn * 10n ** 18n) / sale.price;
  }

  const actions = {
    buy(eth: string) {
      let v: bigint;
      try {
        v = parseEther(eth);
      } catch {
        return;
      }
      if (v <= 0n) return;
      const room = sale.hardCap - sale.totalRaised;
      const accept = v > room ? room : v;
      if (accept <= 0n) return;
      setSale((s) => ({ ...s, totalRaised: s.totalRaised + accept, tokensSold: s.tokensSold + tokensFor(accept) }));
      setMine((m) => ({ contributed: m.contributed + accept, owed: m.owed + tokensFor(accept) }));
      flash();
    },
    finalize() {
      setSale((s) => ({ ...s, finalized: true, succeeded: s.totalRaised >= s.softCap }));
      flash();
    },
    claim() {
      setMine((m) => ({ ...m, owed: 0n }));
      flash();
    },
    refund() {
      setMine({ contributed: 0n, owed: 0n });
      flash();
    },
  };

  return {
    configured: false,
    demo: true,
    sale,
    mine,
    loading: false,
    refetch: () => {},
    actions,
    tx: { hash: undefined, isPending: false, error: null as unknown, reset: () => {}, mining: false, confirmed },
  };
}
