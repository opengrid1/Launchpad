# Meridian

A premium, dark, minimalist crypto finance interface. Original design system —
deep near-black background (`#080A0F`), soft emerald/cyan accents, rounded
18–24px cards, thin borders, spring-based micro-interactions — built to feel
fast, calm and trustworthy.

## Stack

- **Vite + React 18 + TypeScript** — no UI framework, no chart library
- Hand-rolled CSS design system (`src/styles.css`): tokens for color, shape,
  motion and type
- Custom SVG charts (smoothed area chart with hover crosshair, sparklines)
- React Router with animated page transitions
- ~70 KB gzipped total

## Features

- **Landing** — hero with ambient glows, animated stat counters, live market
  spotlight, feature grid, security section, spacious footer
- **Dashboard** — portfolio balance with range-switchable area chart, holdings
  table, activity feed, send flow with confirmation modal and toasts
- **Markets** — search, gainers/losers filters, sortable table with sparklines,
  top movers
- **Token detail** — price chart, statistics, buy/sell confirmation flow
- **Activity** — day-grouped transaction history with type filters and status
  badges
- **Settings** — currency, privacy, notification and network preferences
- Wallet connect (simulated), chain selector, network badge, loading
  skeletons, toast notifications — all persisted to `localStorage`

All market and portfolio data is deterministic demo data (`src/lib/data.ts`);
no backend required.

## Run

```bash
cd meridian
npm install
npm run dev        # http://localhost:5199
npm run build      # production build in dist/
```
