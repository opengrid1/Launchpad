# Robinhood L2 Trading Bot

A Telegram trading bot for **Robinhood L2** (Arbitrum-Nitro, chainId **4663**). It
fetches full token data and trades any token against WETH on the chain's
Uniswap-V3-fork DEX.

## What it does

- **Fetch all token data** — on-chain ERC-20 reads + the chain's Blockscout API
  (holders, transfers, supply) + live price from the V3 pool.
- **Trade** — `/buy` with native ETH and `/sell` for ETH via `SwapRouter02`,
  with slippage protection.
- **Safety check** — for unverified tokens, fabricates a sell via state
  overrides to detect **honeypots** and estimate **sell tax** (no funds needed).

## Chain & DEX (verified on-chain)

| Thing            | Address / value |
|------------------|-----------------|
| Chain ID         | `4663` (`0x1237`) |
| RPC              | `https://poptye-always-win.poptyedev.com/` |
| Explorer         | `https://so-explorer.poptyedev.com` (Blockscout) |
| Native symbol    | ETH |
| WETH9            | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` |
| V3 Factory       | `0x1f7d7550b1b028f7571e69a784071f0205fd2efa` |
| SwapRouter02     | `0xCaf681a66D020601342297493863E78C959E5cb2` |
| PositionManager  | `0x73991a25c818bF1F1128DEaab1492d45638De0d3` |
| $MARIAN (default)| `0x01637b14B7378B99dE75A64d50656d98488D9a4d` |
| MARIAN/WETH pool | `0xFE331fD29b54bCE09D52988FA691e3B18B0A4081` (1% fee) |

## Setup

```bash
cd bot
npm install
cp .env.example .env      # fill in TELEGRAM_BOT_TOKEN, then your Telegram ID
```

`.env` keys:

- `TELEGRAM_BOT_TOKEN` — from @BotFather. **Secret.**
- `TELEGRAM_ALLOWED_IDS` — comma-separated Telegram user IDs allowed to trade.
  Send `/start` to the bot to see your ID, add it, restart.
- `PRIVATE_KEY` — trading wallet. If empty, a fresh wallet is generated and
  written back to `.env`; fund that address with ETH before trading.
- `DRY_RUN` — `true` (default) simulates trades without sending them. Set to
  `false` to trade for real.
- `SLIPPAGE_BPS` — slippage tolerance in basis points (`500` = 5%).

## Run

```bash
npm start                       # start the Telegram bot
npm run info                    # print full $MARIAN data (terminal)
npm run info -- 0xTokenAddr     # any token
npm run info -- --check 0xAddr  # honeypot / safety check
```

## Telegram commands

| Command | Description |
|---------|-------------|
| `/start` | wallet, your ID, mode |
| `/wallet` | ETH balance |
| `/info [token]` | full token data |
| `/check [token]` | safety / honeypot check |
| `/price [token]` | quick price in ETH |
| `/buy <eth> [token]` | buy token with native ETH |
| `/sell <amount\|%> [token]` | sell token for ETH |
| `/snipe <eth> [token] [safe]` | snipe a new launch (`safe` = honeypot-check first) |
| `/unsnipe` | stop the active sniper |

## Sniper

```bash
npm run snipe -- 0.05 0xTokenAddr   # wait for that token's pool, then buy
npm run snipe -- 0.05               # snipe the FIRST new token paired with WETH
npm run snipe -- 0.05 --safe        # honeypot-check before buying
```

**How it works** (`src/sniper.ts`): watches the V3 Factory's `PoolCreated`
events (and, for a known target, any pre-existing pool), then fires a pre-built
ETH→token buy the moment the pool has liquidity, retrying each block until it
lands or `maxBlocks` passes. Snipe buys use `amountOutMinimum = 0`, so the ETH
amount is your risk cap — size it accordingly.

**"0-block" reality on Robinhood L2:** this is an Arbitrum-Nitro chain with **no
public mempool** (`eth_newPendingTransactionFilter` is disabled), so you cannot
see or front-run pending transactions. For **someone else's** launch the earliest
achievable entry is reacting to the confirmed `PoolCreated`/liquidity event and
landing in the next block. Speed levers: pre-fund the wallet, keep
`DRY_RUN=false` only when ready, lower `pollMs`, run near a fast RPC. Honeypot
checks add latency — off by default.

## True block-0: atomic launch + dev-buy

If **you** are the one launching the token, you don't need to race anyone — put
the liquidity-add and your buy in the **same transaction**. The buy then executes
in the same block as liquidity and is guaranteed the first trade. That's
`src/LaunchSnipe.sol` (a Foundry contract in the repo root).

```bash
# 1. Deploy the helper (once) — uses PRIVATE_KEY from env
forge script script/DeployLaunchSnipe.s.sol --rpc-url robinhood --broadcast
#    -> note the deployed address, put it in bot/.env as LAUNCH_SNIPE_ADDRESS

# 2. Launch + snipe atomically: seed 100M tokens + 1 ETH liquidity, dev-buy 0.2 ETH
cd bot
npm run launch -- 0xYourToken 100000000 1 0.2 10000
```

`src/launch.ts` derives the pool's initial `sqrtPriceX96` from your LP amounts
(for a full-range position `amount1/amount0 == price`), picks full-range ticks,
approves the token, and calls `launchAndSnipe` in one tx. Pass several addresses
in `buyers[]`/`buyWethAmounts[]` (edit `launch.ts`) to spread the snipe across
wallets so it looks organic. The LP NFT goes to you; bought tokens go to each
buyer. Run `forge build` once before deploying (this repo uses Foundry).

## How token data is fetched

Three layers, most-authoritative first:

1. **On-chain** (`src/token.ts`) — `name/symbol/decimals/totalSupply/balanceOf`
   via direct `eth_call`, and live price by reading the V3 pool's `slot0`
   (`sqrtPriceX96`).
2. **Pool discovery** — `factory.getPool(token, WETH, fee)` across fee tiers,
   picking the most-liquid pool.
3. **Blockscout API** (`src/explorer.ts`) — holders, recent transfers, market
   metadata at `…/api/v2/tokens/{address}`. (The project's own
   `api-chart.poptyedev.com` is session-gated, so Blockscout is used instead.)

## Security notes

- Secrets live only in `.env`, which is gitignored. Never commit keys/tokens.
- If a bot token is ever exposed, rotate it with `@BotFather → /revoke`.
- Trading is locked to allow-listed Telegram IDs and defaults to `DRY_RUN`.
- This trades unaudited meme tokens on a new chain. Use a burner wallet with
  only funds you can lose, and always `/check` a token first.
