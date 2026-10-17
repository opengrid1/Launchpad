# Inkypump Swap (swap.inkypump.fun)

The AMM front end. Same shell, palette, wallet layer and chain conventions as the launchpad in `../replica`; this folder holds only what is specific to the swap site.

- `build_swap.py` builds `index.html` (Swap), `pools.html`, `liquidity.html` and `stake.html` from `pages/*.html` on top of the o1 shell, reusing the helpers in `../replica/build2.py`. Run it from a folder that has `../ref/` (the captured o1 markup) and `../site2/build2.py` next to it.
- `swapapp.js` drives the token picker, swap form, liquidity form, pools table and staking page. Live data arrives through `window.INKY.swap` once the AMM contracts (`contracts/contracts/v4/inkyswap`) are deployed; until then every action says the AMM is not live yet.
- `swap.css` adds the page layouts; `extra.css`, `app.js`, `data.js`, `avatar.js`, `i18n.js` and `wallet.js` are copied from `../replica` at build time.
- `vercel.json` gives clean URLs (`/`, `/pools`, `/liquidity`, `/stake`) and redirects `/profile` to `/liquidity`.
