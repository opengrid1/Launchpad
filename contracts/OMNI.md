# Equo multichain: decisions so far

Equo coins live on several EVM chains at once, modeled on Pangea (pangea.trade): one coin, its own pool on
each chain, bridged 1:1 with LayerZero. Nothing here is deployed yet. The site shows the design, and
`/?preview=1` shows example coins.

## Chains

Only chains that have tokenized stocks, Uniswap v4 and LayerZero. Ethereum is the main chain.

| Chain | Chain id | LayerZero eid | Stocks | Uniswap v4 PoolManager |
|---|---|---|---|---|
| Ethereum (main) | 1 | 30101 | Ondo (573 priced by our oracle) | `0x000000000004444c5dc75cB358380D2e3dE08A90` |
| HyperEVM | 999 | 30367 | Ondo (~35, bridged by Ondo over LayerZero) | `0x12D4Fd9C5DeDd00ab8a0bCe2CF0167bbf94b6B1F` |
| BNB Chain | 56 | 30102 | Ondo, xStocks | `0x28e2Ea090877bF75740558f6BFB36A5ffeE9e9dF` |
| Base | 8453 | 30184 | Coinbase | `0x498581fF718922c3f8e6A244956aF099B2652b2b` |
| Arbitrum | 42161 | 30110 | xStocks | `0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32` |
| Robinhood Chain | 4663 | 30416 | Robinhood | `0x8366a39CC670B4001A1121B8F6A443A643e40951` |
| Ink | 57073 | 30339 | xStocks | `0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32` |

Left out: Solana (separate Rust stack, about 2 to 3.5 SOL locked per program), Monad and MegaETH (no stock
tokens), Mantle (xStocks but no Uniswap v4).

## What matches Pangea

- 1B supply per chain; total supply is 1B times the number of chains. Every chain opens at the same USD
  start cap. Market cap is the sum over chains.
- Each chain has its own pool. A trader picks the pool to trade on (the coin page's "Buy on" picker) and pays
  in that chain's coin. Arbitrage keeps prices in line.
- LayerZero OFT: burn on the source chain, mint on the destination. 0.2% bridge fee. Fast lane: +0.2% plus a
  relayer fee capped at 10%; a relayer pays the recipient at once and is repaid when the standard message lands.
- The creator pays once, on one chain, for every chain: launch gas (about 7.29M per chain) plus a 20% margin.
  Our operator wallets submit the launch on the other chains. A payment that never lands is refunded, or
  reclaimable after 7 days.
- Routes are pinned at launch (libraries, executor, verifiers); verifiers 2 of N (LayerZero Labs, Nethermind,
  Canary, Horizen; Canary and Horizen are not on Robinhood Chain).

## Where Equo differs on purpose

- Pools pair with a stock (Ondo, Coinbase, Robinhood or xStocks depending on the chain), not the native coin.
- Fee split as in Equo v3: holder rewards and buyback first, then 60% creator and 40% platform; cashback and
  referral come out of the platform part. Takeover and creator tools stay.
- The admin `collect` lever stays (1:1 with OneHook).

## Contract addresses

- **The same coin address on every chain, with no vanity ending.** The token deployer sits at the same
  address on every chain, deployed through the CREATE2 deployer `0x4e59b44847b379578588920cA78FbF26c0B4956C`
  (present on all 7 chains, as is CreateX `0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed`). Each coin uses one
  salt for every chain, and its creation code holds no chain-specific values: the LayerZero endpoint and the
  other per-chain settings are read from the deployer during construction, so the init code hash is
  identical everywhere.
- Only the admin can wire the token deployer on a chain (no first-caller setup). Otherwise anyone could
  deploy the same init code on a new chain first and point it at their own factory.

## Chain-specific notes

- HyperEVM: normal blocks hold 3M gas; launches (about 7.3M) and contract deploys go in big blocks (30M,
  about one a minute). The operator wallet turns big blocks on once through HyperCore.
- Stock tokens differ by issuer per chain. Before the contracts are built, check per chain which stock tokens
  can be moved into a Uniswap pool (no allowlists) and which can be bought with the chain's coin.

## Costs at 2026-10-21 prices

- Deploying our contracts: about $18 for all chains, nearly all of it Ethereum gas.
- One launch on all 7 chains: about $7.30 including the 20% margin, paid by the creator.
