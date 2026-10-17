# onehook-site

The onehook.vercel.app static site, wired to the OneHook v2 mainnet
deployment (see `contracts/contracts/v4/onehook/README.md`).

This directory was reconstructed from the live deployment because the site's
original source is not in any repository this session could reach. It is a
plain static site: `index.html` plus `app.js`, `chain.js`, `wallet.js`,
`config.js`, `data.js`, `demo.js`, `avatar.js`, `i18n.js`, the two
stylesheets, `img/`, and the pre-rendered docs under `docs/`.

## What changed from the live site

- `config.js`: factory, hook, router and token deployer point at the v2
  contracts; `deployBlock` is the factory's deployment block (26213781) so
  event indexing starts there.
- `chain.js`: `positionOf(token)` moved from the hook ABI to the factory ABI
  and is called on the factory instance (the v2 hook holds no liquidity).
  Nothing else in the ABI changed.
- `docs/production-contracts.html`: the address table is filled in with
  Etherscan links. `docs/introduction.html` and `docs/security.html` no
  longer say the contracts are not deployed.
- `vercel.json`: clean URLs for the docs pages, `/docs` redirect, and the SPA
  rewrite for `/launch`, `/profile` and friends.

## Deploy

```bash
npm i -g vercel
vercel deploy onehook-site --prod --yes --token "$VERCEL_TOKEN"
```

Run it from the Vercel project that owns onehook.vercel.app (set
`VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`, or link the directory once with
`vercel link`). The GitHub workflow `.github/workflows/deploy-onehook.yml`
does the same on `workflow_dispatch` using the `VERCEL_TOKEN` secret and the
`VERCEL_ONEHOOK_PROJECT_ID` repository variable.

## After deploying

- Hide the two scan coins from the listing from the admin wallet:
  `factory.setHidden(0xB3DE27D60277de084F5cCDb6D27F3886e81Cf1B2, true)` and
  `factory.setHidden(0x8a195154e1127F7dd42D0d621110e97dd3ce9111, true)`.
- The docs' "Data access" and "Functions and events" pages describe an
  earlier contract interface (per-coin `feeBps()`, `flush`, `sync`). They
  predate this change and still need a rewrite against the v2 ABI.
