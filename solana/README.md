# Equo on Solana

`programs/equo-sol` is the Solana side of Equo. It is written with Pinocchio rather than Anchor, to keep the program small: its rent is charged per byte. Like the EVM factory, one call launches a coin and opens its pool. On Solana the pool is Meteora DAMM v2 instead of Uniswap v4.

## What a launch does

1. **Coin.** It creates a Token-2022 mint with 6 decimals and its name, symbol and image link stored on the mint.
   - The mint authority and freeze authority are removed, so nobody can mint more or freeze a wallet.
   - The metadata update authority is removed, so the name and image can never change.
2. **Supply.** It mints this chain's slice: 1B coins divided by `split`, the same rule the EVM factory uses.
3. **Pool.** It opens a DAMM v2 pool against wrapped SOL.
   - The opening price is the chosen dollar cap preset for 1B coins, so Solana opens at the same market cap as the EVM chains.
   - The position belongs to the coin's PDA, not to a person.
4. **First buy.** The creator's first buy is built into the pool's opening price. They get exactly what a fee-free buy of `first_buy` SOL would give, and nobody can trade before them.
5. **Anti-snipe** (optional). The fee starts at `snipe_bps` and falls linearly to `fee_bps` over `snipe_secs`, in 100 steps, using DAMM v2's fee scheduler.

## Fees

- Trading fees are taken in SOL only.
- `claim_fees` can be called by anyone. It pulls the position's fees and pays **70% to the creator and 30% to the platform**, in wrapped SOL.
- Meteora keeps its protocol share of each pool fee (20%) before that, as on every DAMM v2 pool.
- The creator can hand the creator share to another wallet with `set_creator`.

## Admin

The admin is set once, in `initialize`, which only the program's upgrade authority can call. The admin can:

- `collect`: remove a share (1 to 10000 bps) of a coin's liquidity, sending the coins and SOL to the given accounts. It works like `collect` on the EVM factory. Fees already earned stay claimable.
- Change the fee recipient, the price updater, the minimum first buy, the launch fee, the dollar cap presets, and pause new launches.

The price updater, or the admin, sets SOL/USD with `set_sol_price`. A launch refuses a price older than `max_price_age`.

Limits checked on chain:

| Setting | Allowed range |
|---|---|
| Fee | 10 to 300 bps |
| Anti-snipe | above the fee, at most 3000 bps, over at most 1 day |
| Split | 1 to 20 |

## Build and test

```sh
export PATH=$HOME/.local/share/solana/install/active_release/bin:$PATH
cargo build-sbf                      # target/deploy/equo_sol.so, ~86 KB
cargo test -p equo-sol --lib         # price math
npm install
solana-test-validator --reset --url https://api.mainnet-beta.solana.com \
  --clone-upgradeable-program cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG \
  --upgradeable-program 6mdh7toDGpPEk8CYokVLi2aQMLDnB9jVkzhP5n9Dt4wR target/deploy/equo_sol.so \
  $(solana-keygen pubkey ~/.config/solana/id.json)
npm test                             # end to end against the real DAMM v2 program (fresh validator each run)
```

## Deploy

The program id keypair is in `.keys/equo_sol-program.json`. It is gitignored and is needed for the first deploy only.

```sh
solana -u mainnet-beta -k <deployer.json> program deploy target/deploy/equo_sol.so \
  --program-id .keys/equo_sol-program.json
RPC=https://api.mainnet-beta.solana.com AUTHORITY=<deployer.json> \
  ADMIN=<solana pubkey> FEE_RECIPIENT=<solana pubkey> PRICE_UPDATER=<solana pubkey> \
  node scripts/init.mjs                 # dry run, then EQUO_CONFIRM=1
```

Costs:

- **Deploy:** about 0.60 SOL of rent for the program and 0.002 SOL in fees. A test deploy from a wallet holding 0.7 SOL succeeded.
- **Setup:** about 0.003 SOL for the config account and transactions.
- **Each launch:** about 0.03 SOL of rent, plus the first buy and the launch fee.

## Not on Solana yet

- **Bridge to the EVM chains.** The coin has no mint authority, so a LayerZero bridge would have to lock and release coins rather than mint and burn them. It is planned with the EVM bridge.
- **Holder rewards, buyback and cashback.** DAMM v2 has no swap hook, so these EVM features have no equivalent here.
