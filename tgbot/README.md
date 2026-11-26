# Chipfi Telegram bot

Wallets held by the bot, several per Telegram user, and buy/sell of Chipfi coins and
any NEAR token from chat. Paste a coin symbol, a token address or a chipfi.fun link and tap Buy.

- Wallets: the bot makes one; users add more, import a private key (named or implicit
  account, looked up through FastNear), switch, export, remove.
- Any NEP-141 token: routed through Rhea's smart router, swapped in one
  `ft_transfer_call` into the exchange; sells unwrap back to NEAR.

- Curve coins in NEAR: `buy` with attached NEAR; `sell` + `claim` in one transaction.
- Stock-paired coins: NEAR -> stock through Rhea DCL, then the stock into the coin. Sells go back the same way.
- Coins on Rhea: swaps through the pool, wNEAR unwrapped on the way out.

## Run

```
cp .env.example .env   # fill TG_BOT_TOKEN and a random BOT_SECRET
npm install
npm start
```

`BOT_SECRET` encrypts every user's key at rest. Losing it loses every wallet; changing it does the same. Back it up.
`data/store.json` holds the users. Back it up too.

## Deploy on Fly.io

```
fly launch --no-deploy --copy-config
fly volumes create botdata --size 1 --region sin
fly secrets set TG_BOT_TOKEN=... BOT_SECRET=...
fly deploy
```

Deploys from the `tgbot` folder on every push; the volume at `/data` holds the wallet file.
