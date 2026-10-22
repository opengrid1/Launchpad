/* Hyperliquid prices for the site: HYPE and the stocks behind the xStocks, read from Hyperliquid's public info API
   (the same mids HyperCore's oracle follows), so the pair prices show before the Liqio oracle is on chain and keep
   ticking between chain refreshes. Each wrapped xStock is scaled by its ERC-4626 share ratio, read from the token.
   Loaded after chain.js, before core.js. Exposes window.HL = { prices (promise), usd(addr) }. */
(function () {
  const cfg = window.INKY || {};
  const API = 'https://api.hyperliquid.xyz/info';
  const WETH = String(cfg.weth || '').toLowerCase();
  const pairs = (cfg.cryptoPairs || []).concat(cfg.stocks || []);
  const C = window.CHAIN;
  const ratios = {};
  let cache = {}, at = 0, inflight = null;

  async function mids() {
    const out = {};
    const q = async (body) => { const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error('hl ' + r.status); return r.json(); };
    const want = new Set(pairs.map((p) => p.hl).filter(Boolean));
    const dexes = new Set([...want].map((k) => (k.includes(':') ? k.split(':')[0] : '')));
    await Promise.all([...dexes].map(async (dex) => { try { Object.assign(out, await q(dex ? { type: 'allMids', dex } : { type: 'allMids' })); } catch (e) { console.warn('hl mids', dex, e); } }));
    if (!('HYPE' in out)) { try { Object.assign(out, await q({ type: 'allMids' })); } catch {} }
    return out;
  }
  async function ratioOf(p) {
    if (!p.erc4626) return 1;
    if (ratios[p.address] && Date.now() - ratios[p.address].at < 600000) return ratios[p.address].v;
    let v = 1;
    try {
      if (C && C._lib) { const { ethers: E, provider } = C._lib; const r = await new E.Contract(p.address, ['function convertToAssets(uint256) view returns (uint256)'], provider).convertToAssets(10n ** 18n); v = Number(r) / 1e18 || 1; }
    } catch (e) { console.warn('hl ratio', p.symbol, e); }
    ratios[p.address] = { v, at: Date.now() };
    return v;
  }
  async function load() {
    const m = await mids();
    const next = {};
    if (m.HYPE) next[WETH] = Number(m.HYPE);
    await Promise.all(pairs.map(async (p) => {
      let v = 0;
      if (p.fixed) v = Number(p.fixed);
      else if (p.hl && m[p.hl]) v = Number(m[p.hl]) * (p.mult || 1) * (await ratioOf(p));
      if (v > 0) next[String(p.address).toLowerCase()] = v;
    }));
    cache = next; at = Date.now();
    return next;
  }
  const HL = {
    prices() { if (inflight) return inflight; if (at && Date.now() - at < 20000) return Promise.resolve(cache); inflight = load().finally(() => { inflight = null; }); return inflight; },
    usd(a) { return cache[String(a || '').toLowerCase()] || 0; },
    /** the Hyperliquid market behind a pair, for labels */
    market(a) { const p = pairs.find((x) => String(x.address).toLowerCase() === String(a || '').toLowerCase()); return p ? (p.hl || (p.fixed ? 'fixed' : '')) : (String(a || '').toLowerCase() === WETH ? 'HYPE' : ''); },
  };
  window.HL = HL;
  // the chain layer answers pair prices from here when the Liqio oracle is not on chain yet (or fails), and the
  // site's price map fills in one call
  if (C) {
    const orig = C.pairUsd;
    C.pairUsd = async (a) => { let v = 0; try { v = orig ? await orig(a) : 0; } catch {} if (v > 0) return v; try { await HL.prices(); } catch {} return HL.usd(a); };
    C.hlPairPrices = async (list) => { const got = await HL.prices(); const out = {}; (list || []).forEach((a) => { const k = String(a).toLowerCase(); if (got[k]) out[k] = got[k]; }); return out; };
  }
  HL.prices().catch(() => {});
  setInterval(() => { HL.prices().then(() => { if (window.SP && SP.prices) { Object.assign(SP.prices, cache); document.dispatchEvent(new Event('hl-prices')); } }).catch(() => {}); }, 30000);
})();
