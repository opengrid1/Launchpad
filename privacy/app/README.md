# Umbra dApp

Frontend for the Umbra privacy protocol: the $UMBRA presale and the shielded
pool. React + Vite + TypeScript, wagmi + viem for the chain. Same dark charcoal
and amber look as the landing site.

```bash
npm install
npm run dev      # local dev
npm run build    # type-check + production build
```

## Wiring the backend (one file)

The whole app reads addresses from `src/lib/config.ts`. After deploying the
contracts to the testnet, paste the addresses there and everything lights up:

```ts
export const ADDRESSES = {
  umbraToken:   "0x…",
  presale:      "0x…",
  shieldedPool: "0x…",
};
```

Empty strings mean "not deployed yet" and the UI shows a not-live state instead
of erroring, so the app is safe to ship before the contracts exist.

## Layout

- `src/wagmi.ts` chain + connector config (Sepolia; add mainnet/Base here later)
- `src/lib/config.ts` addresses and pool denominations (the one file to edit)
- `src/lib/abis.ts` typed ABIs matching `privacy/src/*.sol`
- `src/lib/note.ts` shielded-pool note model (generate / encode / decode)
- `src/hooks/usePresale.ts` batched reads + buy / claim / refund / finalize
- `src/pages/Presale.tsx` fully wired against the presale contract
- `src/pages/Pool.tsx` deposit / withdraw shape; the deposit and withdraw
  buttons stay disabled until the in-browser prover lands (see below)

## Still to wire

The pool's deposit and withdraw need an in-browser prover (circomlibjs for the
Poseidon commitment, snarkjs + the circuit wasm/zkey for the Groth16 proof).
Note generation already runs client-side; the contract call
`pool.deposit(commitment)` is wired and waiting on the commitment.
