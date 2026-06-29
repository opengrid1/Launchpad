# Veil — private transfers (frontend demo)

A UX prototype for a **Veil Cash-style privacy pool** on HyperEVM. You deposit a
fixed amount, get a secret note, and later withdraw to a fresh address with no
on-chain link back to the deposit. Built as a frontend-first exploration of the
flow — React 19 + TypeScript + Vite + Tailwind v4, same toolchain as the
`app/` launchpad in this repo.

> ⚠️ **Demo only.** Notes are generated with browser SHA-256, not a zk-SNARK,
> and nothing is sent to a blockchain. The screens mirror the real protocol's
> shape (commitment → note → nullifier → relayer) so you can feel the UX, but
> it provides **no actual privacy**. A real build needs audited circuits,
> contracts, and a relayer network.

## Screens

| Page | What it does |
| --- | --- |
| **Deposit** | Pick a denomination (0.1 / 1 / 10 / 100 HYPE), generate a commitment + secret note, "deposit" into the pool. |
| **Withdraw** | Paste a note, set a recipient, simulate proof generation, withdraw (optionally via a gas-paying relayer). |
| **Pool** | Anonymity-set sizes, TVL, and a public activity feed — the ledger is open; the deposit↔withdrawal link is not. |
| **About** | How the commitment / note / nullifier / relayer model works and what privacy actually depends on. |

## Key files

| File | Purpose |
| --- | --- |
| `src/lib/notes.ts` | Note generation, encoding/parsing, commitment + nullifier hashing (Web Crypto, demo only) |
| `src/data/pool.ts` | Mock pool stats, recent activity, relayer fee |
| `src/pages/*` | Deposit, Withdraw, Pool, About screens |
| `src/components/*` | Header, denomination picker, note card, step indicator |

## Run

```bash
cd veil-app
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build
npm run lint
```

## Toward a real protocol

The next steps to make this more than a mock:

1. **Contracts** — a pool contract per denomination with a Merkle tree of
   commitments and a spent-nullifier set (mirrors the `src/` Foundry setup).
2. **Circuits** — Poseidon-based commitments and a Groth16/PLONK circuit proving
   tree membership + nullifier derivation.
3. **Relayer** — an off-chain service that submits withdrawals and takes a fee so
   recipients need no gas.
4. **Compliance** (the "Veil" angle) — optional verified-deposit gating /
   association-set proofs so honest users can prove provenance.
