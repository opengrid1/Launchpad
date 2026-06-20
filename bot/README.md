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
