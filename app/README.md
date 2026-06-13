# Hyprpad — launchpad frontend

React + TypeScript + Vite frontend for the Hyprpad launchpad on HyperEVM mainnet,
wired to the live `Launchpad` contract (`0xc985b4dda3ae887152ba79558ed7939fbe3a7549`).

## Pages

- **Board** (`#/`) — every launched token, live from chain: market cap (USD via the
  HyperCore oracle), lifetime fees, search, sort by newest / mcap / top earners.
- **Launch** (`#/launch`) — one-click token launch from the browser. Handles the
  HyperEVM big-block dance automatically: signs the `evmUserModify` HyperCore action
  (verified byte-identical to the official Python SDK), sends the atomic
  `createToken` tx (token + pool + locked liquidity + optional dev buy), then offers
  to switch the wallet back to fast blocks. Metadata (image, description, socials)
  is stored fully on-chain as a base64 data-URI — no IPFS or backend needed.
- **Token** (`#/t/<address>`) — mcap/liquidity/fees stats, GeckoTerminal TradingView chart embed,
  buy/sell directly through HyperSwap V3 (quotes via `eth_call` simulation with
  balance overrides, slippage control, approval flow for sells, native HYPE
  unwrap on exit), creator rewards panel (collect + claim).

## Stack

Plain viem (no wagmi) + hand-rolled wallet context, multicall-batched reads,
hash routing, Tailwind v4 with the project's ink/mint design system.

## Develop

```bash
npm install
npm run dev       # local dev server
npm run build     # typecheck + production bundle
npm run lint
npx tsx scripts/verify.ts   # integration checks against mainnet (16 assertions)
```

## Deploy

`npm run build` and host `dist/` on any static host (Vercel, Netlify, Cloudflare
Pages). No server-side code, no env vars — the contract address lives in
`src/lib/contracts.ts`.
