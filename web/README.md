# Par — web

The interface for **Par**, a fixed-price token launchpad on Ethereum mainnet.
No bonding curve: every subscriber in an offering pays the same par price, the
first wallet and the last. Clear the soft cap and liquidity is paired on Uniswap
with the LP burned; miss it and everyone withdraws their ETH in full.

Built as a working product, not a marketing site. Three screens map to the three
things a user actually does:

- **Board** — the issuance ledger. Every open, scheduled, funded, and refunding
  offering in one columnar view, with live subscription against each hard cap.
- **Offering** — the prospectus. Terms, settlement mechanics, and a state-aware
  action panel (subscribe / claim / withdraw / notify).
- **Issue** — open an offering, with a live prospectus preview that updates as
  you set the par price, supply, caps, and liquidity share.

## Design notes

- The only diagram in the app is the **par line** — a flat price struck against
  the bonding curve it replaces. It argues the thesis instead of decorating.
- The only animation is a subscription meter advancing toward its cap; it tracks
  a real number. Nothing blinks or pulses for attention.
- Identity is carried by typography, spacing, and a deliberate palette (bone
  paper, ink, one oxblood accent, green/red for settle/fail), not effects.
- All figures are monospaced and tabular so columns of numbers align like a
  ledger. Data in `src/data/offerings.ts` is internally consistent
  (`hardCap = par × tokensOffered`, `raised ≤ hardCap`, `softCap ≤ hardCap`).

This is a front end over mock data; wiring it to the on-chain launchpad (wallet
connection, contract reads/writes) is the next step.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build
```

Stack: React 19, Vite, Tailwind v4. Type families: Fraunces, Hanken Grotesk,
Spline Sans Mono.
