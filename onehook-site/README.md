# onehook-site

The onehook.vercel.app static site, wired to the OneHook v2 mainnet
deployment (see `contracts/contracts/v4/onehook/README.md`). Live since
2026-10-17 as Vercel project `onehook` (prj_M89idzbFXptvrqudoCq6Ct6bZaVz,
team hypurrs-projects).

This directory is the full file set of the production deployment, pulled from
the Vercel API, with the v2 wiring applied. One directory is deliberately
absent: `charting_library/` (1,952 files, the TradingView charting library).
It is licensed software and must not be committed to this public repository,
so it is gitignored here. A deploy needs it back in place first (copy it from
the previous Vercel deployment with the API, or from the private source).

## What changed from the previous deployment

- `config.js`: factory, hook, router and token deployer point at the v2
  contracts; `deployBlock` is the factory's deployment block (26213781).
- `chain.js`: `positionOf(token)` moved from the hook ABI to the factory ABI
  and is called on the factory instance (the v2 hook holds no liquidity).
  Nothing else in the ABI changed.
- `docs/production-contracts.html`: the address table is filled in with
  Etherscan links. `docs/introduction.html` and `docs/security.html` no
  longer say the contracts are not deployed.
- `vercel.json` is the site's own (clean URLs, `/token/:addr` rewrite,
  `/docs` and `/portfolio` redirects, cache headers), unchanged.

## Deploy

```bash
# charting_library/ must exist inside onehook-site/ first
vercel deploy onehook-site --prod --yes --archive=tgz --token "$VERCEL_TOKEN"
```

with `VERCEL_ORG_ID=team_lk1ckVdpYplOMlYBlWsSZ5u2` and
`VERCEL_PROJECT_ID=prj_M89idzbFXptvrqudoCq6Ct6bZaVz` in the environment. The
GitHub workflow `.github/workflows/deploy-onehook.yml` runs the same command
on `workflow_dispatch` and refuses to deploy without `charting_library/`.

## After deploying

- Hide the two scan coins from the listing from the admin wallet:
  `factory.setHidden(0xB3DE27D60277de084F5cCDb6D27F3886e81Cf1B2, true)` and
  `factory.setHidden(0x8a195154e1127F7dd42D0d621110e97dd3ce9111, true)`.
- The docs' "Data access" and "Functions and events" pages describe an
  earlier contract interface (per-coin `feeBps()`, `flush`, `sync`). They
  predate this change and still need a rewrite against the v2 ABI.

## Original build notes (from the site's own README)

Builds the launchpad front end (home, token, launch, profile, leaderboard,
docs, admin) from the captured reference markup and compiled stylesheet in
`ref/`, re-skinned with our palette and content.

```
pip install beautifulsoup4
cd web/replica && python3 build2.py      # writes *.html, o1.css next to this file
python3 checkcls.py index.html token.html # reports utility classes missing from the stylesheet
```

Deploy the generated `*.html`, `o1.css`, `extra.css`, `app.js`, `pages.js`,
`data.js` as a static site. Behaviour lives in `app.js` (header menus, search,
wallet, chart, trades, swap, feed) and `pages.js` (launch wizard, profile,
leaderboard, docs, admin). Mock data is in `data.js`.
