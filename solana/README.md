# Equo on Solana

`programs/equo-sol` launches a coin straight into a **Raydium CLMM** pool. It is written with Pinocchio rather than Anchor, to keep the program small: its rent is charged per byte.

Equo is Solana-only for now. The multichain version (LayerZero coin on Meteora DAMM v2) is parked in `archive/equo-sol-v2-omni`, and the first deployed version in `archive/equo-sol-v1-damm`.

## What a launch does

One transaction, signed by the creator:

1. **Coin.** A Token-2022 mint: 1B coins, 9 decimals, name, symbol and image link on the mint.
   - No freeze authority. The metadata update authority is removed, so the name and image never change.
   - The mint authority is removed once the 1B exists, so nobody can mint more.
2. **Pair and price.** The pair is SOL or one of a fixed list of xStocks (SPYx, QQQx, NVDAx, TSLAx, AAPLx, GOOGLx, METAx, CRCLx, MSTRx, COINx). The list is in the program; there is no admin setting for it.
   - The opening market cap is **$3,000**, priced from the pair's Pyth USD feed. The price must be fully verified and at most 10 minutes old.
   - The client sends the start tick; the program checks it is the first tick at or past $3,000. So a coin opens at $3,000 to $3,000 plus one tick spacing (1.2% at the 1% tier).
3. **Pool.** A Raydium CLMM pool against the pair, with the fee tier the creator picks: **0.25% to 4%**.
   - Fees are taken in the **pair token only** (CLMM's "collect fee on" setting).
   - The pool is created by a PDA of this program. A CLMM pool's creator may add reward programs to it, so that role stays with the program.
4. **Position.** All 1B coins go into one position, from the opening price to the end of the price range. At the start the pool holds only coins (single sided). The position NFT belongs to the coin's PDA.
   - A few millionths of a coin are left out for the pool's rounding; they go to the creator.
5. **Launch buy** (optional). It is built into the opening price: the pool opens at the price a fee-free buy of that much would reach. The creator gets those coins, and nobody can trade before them.

Sells can bring the price back to the opening price but not below it: there is no pair token in the pool below that point.

## Fees

Raydium keeps its protocol and fund shares of each trading fee (16% today) before the rest reaches the position.

- `claim_fees` can be called by anyone. It pulls the position's fees (pair token) and pays:
  - the platform: the larger of **20% of the trading fee** and **0.2% of the volume**;
  - the creator: the rest.
- Worked out on what reaches the position, the platform's share is 23.8% at 1% to 4% fees, and 95.2% at 0.25%.
- The creator can hand the creator share to another wallet with `set_creator`.

## Admin

The admin is set once, in `initialize`, which only the program's upgrade authority can call. The admin can:

- `collect`: remove a share (1 to 10000 bps) of a coin's liquidity, sending the coins and pair tokens to the given accounts. Fees earned so far stay with the coin, for `claim_fees`.
- `set_fee_recipient`: change where the platform's fees go.

## Costs

- **Each launch:** about **0.22 SOL** of rent, paid by the creator, plus the launch buy. Most of it (0.144 SOL) is Raydium's two tick-array accounts, which every CLMM position needs; the pool's own accounts are about 0.05 SOL and the coin about 0.02 SOL.
- **Program upgrade:** the program is 98 KB and the deployed program data holds 86 KB, so the upgrade extends it by about 12 KB (about 0.08 SOL). The upload buffer needs about 0.5 SOL while it runs; that comes back when the upgrade completes.

## Build and test

```sh
export PATH=$HOME/.local/share/solana/install/active_release/bin:$PATH
cargo build-sbf --manifest-path programs/equo-sol/Cargo.toml   # target/deploy/equo_sol.so
cargo test -p equo-sol --lib                                    # price and tick math, fee share
npm install
node scripts/test-accounts.mjs      # once: Pyth price accounts and an SPYx account, copied from mainnet
scripts/test-validator.sh &         # the real Raydium CLMM, cloned from mainnet; restart before each run
npm test                            # end to end
```

A launch names 28 accounts, so it is sent as a versioned transaction with an address lookup table holding the fixed ones (programs, config, fee tiers, pairs, price accounts). The tests build one; the site needs one on mainnet.

## Deploy

```sh
solana -u mainnet-beta -k <deployer.json> program extend 6mdh7toDGpPEk8CYokVLi2aQMLDnB9jVkzhP5n9Dt4wR 11700
solana -u mainnet-beta -k <deployer.json> program deploy target/deploy/equo_sol.so \
  --program-id 6mdh7toDGpPEk8CYokVLi2aQMLDnB9jVkzhP5n9Dt4wR
RPC=https://api.mainnet-beta.solana.com AUTHORITY=<deployer.json> \
  ADMIN=<solana pubkey> FEE_RECIPIENT=<solana pubkey> node scripts/init.mjs   # dry run, then EQUO_CONFIRM=1
```

## Known limits

- **xStocks are controlled by their issuer.** They can be paused, and their issuer can move tokens (permanent delegate), including out of a pool. A coin paired with an xStock carries that risk.
- **xStock prices ignore the token's UI multiplier.** Pyth prices one xStock as shown in wallets; after a dividend the raw-unit price can drift from that by a few percent, and the opening cap with it.
- **xStock Pyth feeds are not kept fresh on Solana.** Unlike SOL/USD, nobody pays to push them, so a launch on an xStock first posts a fresh Pyth update in the same flow.
