# Equo on Solana v2 (multichain leg) — parked

The Solana leg of a multichain Equo launch: EIP-712 snapshot checked with Solana's keccak and secp256k1
syscalls, Token-2022 coin whose mint authority goes to a LayerZero OFT store, Meteora DAMM v2 pool.

Parked when Equo went Solana-only on Raydium CLMM (see `programs/equo-sol`). Kept here, uncompiled, for when
multichain comes back. To build it again, copy `lib.rs` and `math.rs` over `programs/equo-sol/src/`.
