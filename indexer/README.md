# Equo indexer

Reads every Equo chain and keeps a Postgres copy of what the site needs for history:

- **launches** (factory `Launched`), grouped into one coin across chains through the coin's LayerZero peers
- **trades** (PoolManager `Swap` in Equo pools, with the hook's `FeeTaken`), with the wallet, time and USD value
- **balances** (coin `Transfer`, so bridging burns and mints move them) for holders and supply per chain
- **bridges** (`OFTSent` / `OFTReceived`)
- **pair prices** from each chain's factory oracle, sampled every minute

Live numbers (price, balances, quotes) still come straight from the chains in the browser. If the indexer is down,
trading keeps working; only charts, trade lists and holders wait for it.

## API

All `GET`, JSON, CORS open (set `CORS_ORIGIN` to lock it). `coin` is any of the coin's contract addresses, on any chain.

| Path | What |
|---|---|
| `/api/health` | indexed block, head and lag per chain |
| `/api/coins?sort=new\|vol&limit=&chain=` | coins with per-chain price, supply, 24h volume and trades; market cap |
| `/api/coin?coin=` | one coin, plus holder count |
| `/api/trades?coin=&chain=&wallet=&before=&limit=` | trades, newest first, all chains unless `chain` |
| `/api/candles?coin=&res=&from=&to=&chain=&unit=` | OHLCV; no `chain` = every chain merged; `unit=pair` (one chain) for pair units |
| `/api/holders?coin=&limit=` | wallets across chains, with the balance on each chain |
| `/api/bridges?coin=` | bridge sends and receipts |
| `/api/tick` | serverless hosting only (`TICK=1`): index new blocks in a short burst |

`res` is one of 60, 300, 900, 1800, 3600, 14400, 86400, 604800 seconds. Prices are USD per whole coin; market cap
is the sum over chains of the supply on that chain times that chain's last price.

## Run it

You need Postgres 14+ and Node 20+.

```sh
cd indexer
npm ci
DATABASE_URL=postgres://user:pass@host/db npm start    # worker + API on $PORT (8080)
```

`MODE=worker` or `MODE=api` runs only one half (two services on one database). `MODE=migrate` only creates the tables.

### Chains

`chains.json` lists the eight chains. A chain without a `factory` is skipped, so after deploying Equo on a chain, fill in
its `factory`, `hook`, `tokenDeployer`, `router` and `startBlock` (the factory's deploy block) and restart. The worker
then reads that chain from its start block and keeps following it.

Environment overrides per chain (`<KEY>` is `ETH`, `BASE`, `BSC`, `ARBITRUM`, `HYPER`, `MONAD`, `MEGAETH`, `UNICHAIN`):

- `RPC_<KEY>`: comma-separated RPC URLs, tried in order. Use a provider key here (Alchemy, QuickNode, dRPC…) for
  speed and full history; the public RPCs in `chains.json` work but are slow and some keep only recent logs.
- `FACTORY_<KEY>`, `HOOK_<KEY>`, `START_BLOCK_<KEY>`, `MAX_RANGE_<KEY>`

Other settings: `PORT`, `CORS_ORIGIN`, `POLL_MS`, `PRICE_EVERY_MS`, `DB_POOL`, `BATCH_RANGES`.

### Hosting

**As it runs now (no extra server):** the API is a Vercel function in the site's own project
(`stockpad-site/api/index.mjs`, with this folder copied to `stockpad-site/api/_indexer` at deploy). Indexing runs in
short bursts: `/api/tick` takes a lease in `tick_lock` and lets every chain catch up for up to ~45 s; the site calls
it every 30 s while someone has a page open, and a daily Vercel cron covers quiet days. The Vercel project's
environment holds `DATABASE_URL` (Neon) and `TICK=1`. With nobody on the site, indexing waits and catches up on the
next visit.

**Always on (when traffic grows):** run this folder as a Docker service (Railway, Fly.io…) with `DATABASE_URL`, and
remove `TICK` from the Vercel project so only one indexer writes. Never run both: the same transfers would be applied
twice.

Neon URLs connect over a WebSocket on port 443 (`@neondatabase/serverless`); any other Postgres uses `pg`.

## Test

End to end against three local Equo chains (launches, trades, bridges), checked against the contracts:

```sh
cd contracts && npx hardhat node                      # terminal 1
OUT=/tmp/omni.json npx hardhat run scripts/omni-local-fixture.ts --network localhost
cd ../indexer && FIXTURE=/tmp/omni.json DATABASE_URL=postgres://…/empty_db node test/e2e.mjs
```
