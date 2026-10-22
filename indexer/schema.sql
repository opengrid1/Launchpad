-- Equo indexer schema. Safe to run again: every statement is idempotent.
-- Amounts are raw base units (numeric); USD values are computed when a row is written.

-- how far each chain is indexed (inclusive)
create table if not exists chain_state (
  chain       text primary key,
  last_block  bigint not null,
  head_block  bigint,
  updated_at  timestamptz not null default now()
);

-- one row per coin contract on one chain (the factory's Launched event)
create table if not exists tokens (
  chain         text not null,
  token         text not null,
  coin_id       text not null,            -- the same for a coin's contracts on every chain
  creator       text not null,
  pair          text not null,
  pool_id       text not null,
  name          text,
  symbol        text,
  launch_block  bigint not null,
  launch_ts     bigint not null,
  launch_tx     text not null,
  launch_pair_usd numeric,                -- the factory's opening pair price (USD 18 dec per 1e18 base units)
  primary key (chain, token)
);
create index if not exists tokens_coin on tokens (coin_id);
create index if not exists tokens_pool on tokens (chain, pool_id);

-- swaps in a coin's pool (PoolManager Swap + the hook's FeeTaken in the same tx)
create table if not exists trades (
  chain      text not null,
  tx         text not null,
  log_index  int not null,
  token      text not null,
  coin_id    text not null,
  wallet     text not null,
  buy        boolean not null,
  coin_amt   numeric not null,
  pair_amt   numeric not null,
  fee        numeric not null default 0,
  block      bigint not null,
  ts         bigint not null,
  price_usd  double precision,            -- USD per whole coin
  value_usd  double precision,            -- USD value of the pair side
  primary key (chain, tx, log_index)
);
create index if not exists trades_coin_ts on trades (coin_id, ts desc);
create index if not exists trades_token_ts on trades (chain, token, ts desc);
create index if not exists trades_wallet on trades (wallet);

-- coin balances per chain, kept from Transfer events (mints and burns included, so bridging moves balances)
create table if not exists balances (
  chain    text not null,
  token    text not null,
  wallet   text not null,
  balance  numeric not null,
  primary key (chain, token, wallet)
);
create index if not exists balances_token on balances (chain, token, balance desc);

-- coins sent between chains (OFTSent on the source, OFTReceived on the destination)
create table if not exists bridges (
  chain      text not null,
  tx         text not null,
  log_index  int not null,
  token      text not null,
  coin_id    text not null,
  direction  text not null,               -- 'out' or 'in'
  guid       text not null,
  peer_eid   bigint not null,
  wallet     text not null,
  amount_sent     numeric,
  amount_received numeric,
  block      bigint not null,
  ts         bigint not null,
  primary key (chain, tx, log_index)
);
create index if not exists bridges_coin on bridges (coin_id, ts desc);
create index if not exists bridges_guid on bridges (guid);

-- pair prices in USD (18 dec per 1e18 base units), sampled from each chain's factory oracle
create table if not exists pair_prices (
  chain  text not null,
  pair   text not null,
  ts     bigint not null,
  usd18  numeric not null,
  primary key (chain, pair, ts)
);
