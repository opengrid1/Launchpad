/* Etherhook data: the sample strategy coins (until the contracts are live) and the few
   live Ethereum reads the preview needs: ETH price, gas, and the pair check on the
   launch form, which looks for Uniswap V2 and V3 pools against ETH or USDC.
   Exposes window.BS and fires 'bs:ready'. */
(function () {
  const CFG = window.BACKSTOP || {};
  const lower = a => (a || '').toLowerCase();
  const WETH = lower(CFG.weth), USDC = lower(CFG.usdc);
  const KNOWN = Object.fromEntries((CFG.tokens || []).map(t => [lower(t.address), t]));
  const SUPPLY = 1e9;

  // ------------------------------------------------------------ JSON-RPC over public endpoints, batched, rotating on failure
  const RPCS = CFG.rpcs || [];
  let rpcAt = 0;
  async function rpcBatch(calls) {
    const body = JSON.stringify(calls.map((c, i) => ({ jsonrpc: '2.0', id: i, method: c.method, params: c.params || [] })));
    let lastErr;
    for (let k = 0; k < RPCS.length; k++) {
      const url = RPCS[(rpcAt + k) % RPCS.length];
      try {
        const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 9000);
        const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: ctl.signal }); clearTimeout(tm);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json(); const arr = Array.isArray(j) ? j : [j];
        if (arr.length && arr.every(x => x.error) && calls.length > 1) throw new Error(arr[0].error.message || 'rpc error');
        rpcAt = (rpcAt + k) % RPCS.length;
        const out = new Array(calls.length).fill(null); for (const x of arr) if (x && x.id != null) out[x.id] = x.error ? null : x.result;
        return out;
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('No Ethereum RPC answered');
  }
  const pad = h => h.replace(/^0x/, '').toLowerCase().padStart(64, '0');
  const call = (to, data) => ({ method: 'eth_call', params: [{ to, data }, 'latest'] });
  const word = (hex, i) => hex && hex.length >= 2 + 64 * (i + 1) ? BigInt('0x' + hex.slice(2 + 64 * i, 2 + 64 * (i + 1))) : null;
  const addrWord = (hex) => hex && hex.length >= 66 ? '0x' + hex.slice(26, 66) : null;
  function str(hex) {
    if (!hex || hex === '0x') return null;
    try {
      const h = hex.slice(2);
      if (h.length === 64) return decodeURIComponent(h.replace(/(00)+$/, '').replace(/../g, '%$&')); // bytes32 symbols (old tokens)
      const len = Number(BigInt('0x' + h.slice(64, 128))); return new TextDecoder().decode(Uint8Array.from(h.slice(128, 128 + len * 2).match(/../g) || [], b => parseInt(b, 16)));
    } catch { return null; }
  }
  const SEL = { symbol: '0x95d89b41', name: '0x06fdde03', decimals: '0x313ce567', balanceOf: '0x70a08231', getPool: '0x1698ee82', getPair: '0xe6a43905', slot0: '0x3850c7bd', getReserves: '0x0902f1ac', latestRoundData: '0xfeaf968c' };

  const memo = {}; const cached = async (k, ttl, fn) => { const m = memo[k]; if (m && m.t + ttl > Date.now()) return m.v; const v = await fn(); memo[k] = { v, t: Date.now() }; return v; };
  let demo = null;
  async function ethUsd() {
    try { return await cached('ethUsd', 60000, async () => { const [r] = await rpcBatch([call(CFG.ethUsdFeed, SEL.latestRoundData)]); const a = word(r, 1); if (!a) throw new Error('feed'); return Number(a) / 1e8; }); }
    catch { return demo ? demo.ethUsd : 2700; }
  }
  async function gasGwei() { return cached('gas', 30000, async () => { const [g] = await rpcBatch([{ method: 'eth_gasPrice' }]); return Number(BigInt(g)) / 1e9; }); }

  // ------------------------------------------------------------ pair check: Uniswap V2 and V3 pools against ETH or USDC
  const V3_FEES = [100, 500, 3000, 10000];
  async function checkToken(addrIn) {
    const a = lower(addrIn);
    if (!/^0x[0-9a-f]{40}$/.test(a)) return { ok: false, reason: 'That is not an Ethereum address.' };
    const known = KNOWN[a];
    const e = await ethUsd();
    if (a === WETH) return { ok: true, address: a, symbol: 'ETH', name: 'Ether', decimals: 18, logo: known && known.logo, priceUsd: e, pools: [{ dex: 'Chainlink', depthUsd: Infinity, label: 'ETH/USD price feed' }], note: 'Priced by Chainlink.' };
    const [code, sym, name, dec] = await rpcBatch([{ method: 'eth_getCode', params: [a, 'latest'] }, call(a, SEL.symbol), call(a, SEL.name), call(a, SEL.decimals)]);
    if (!code || code === '0x') return { ok: false, address: a, reason: 'No contract at this address on Ethereum.' };
    const decimals = dec ? Number(BigInt(dec)) : null;
    if (decimals == null || decimals > 36) return { ok: false, address: a, reason: 'This contract does not look like an ERC-20 token.' };
    const info = { address: a, symbol: (known && known.symbol) || str(sym) || '???', name: (known && known.name) || str(name) || 'Unknown token', decimals, logo: known ? known.logo : '' };
    if (a === USDC) return { ...info, ok: true, priceUsd: 1, pools: [{ dex: 'Chainlink', depthUsd: Infinity, label: 'Pegged, checked against USDC/USD' }], note: 'Priced at $1, checked against the Chainlink USDC/USD feed.' };
    // find the pools
    const quotes = [WETH, USDC];
    const finds = [];
    for (const q of quotes) {
      const [t0, t1] = a < q ? [a, q] : [q, a];
      finds.push({ q, kind: 'v2', c: call(CFG.uniV2Factory, SEL.getPair + pad(t0) + pad(t1)) });
      for (const f of V3_FEES) finds.push({ q, kind: 'v3', fee: f, c: call(CFG.uniV3Factory, SEL.getPool + pad(t0) + pad(t1) + pad(f.toString(16))) });
    }
    const res = await rpcBatch(finds.map(f => f.c));
    const pools = finds.map((f, i) => ({ ...f, pool: addrWord(res[i]) })).filter(p => p.pool && !/^0x0{40}$/.test(p.pool));
    if (!pools.length) return { ...info, ok: false, pools: [], reason: `No Uniswap V2 or V3 pool pairs ${info.symbol} with ETH or USDC.` };
    // depth on the ETH/USDC side and the price each pool gives
    const reads = []; for (const p of pools) { reads.push(call(p.q, SEL.balanceOf + pad(p.pool))); reads.push(call(p.pool, p.kind === 'v3' ? SEL.slot0 : SEL.getReserves)); }
    const out = await rpcBatch(reads);
    const qUsd = { [WETH]: e, [USDC]: 1 }; const qDec = { [WETH]: 18, [USDC]: 6 };
    const rows = pools.map((p, i) => {
      const bal = word(out[2 * i], 0); const st = out[2 * i + 1];
      const depthUsd = bal == null ? 0 : Number(bal) / 10 ** qDec[p.q] * qUsd[p.q];
      const tokenIs0 = a < p.q; let px = null;
      if (p.kind === 'v3') { const s = word(st, 0); if (s) { const r = (Number(s) / 2 ** 96) ** 2; const oneIn0 = r * 10 ** (tokenIs0 ? decimals - qDec[p.q] : qDec[p.q] - decimals); px = (tokenIs0 ? oneIn0 : 1 / oneIn0) * qUsd[p.q]; } }
      else { const r0 = word(st, 0), r1 = word(st, 1); if (r0 && r1) { const rt = Number(tokenIs0 ? r0 : r1) / 10 ** decimals, rq = Number(tokenIs0 ? r1 : r0) / 10 ** qDec[p.q]; px = rt ? rq / rt * qUsd[p.q] : null; } }
      return { dex: p.kind === 'v3' ? 'Uniswap V3' : 'Uniswap V2', fee: p.fee, pool: p.pool, quote: p.q === WETH ? 'ETH' : 'USDC', depthUsd, priceUsd: px, label: `${p.kind === 'v3' ? 'Uniswap V3 ' + p.fee / 10000 + '%' : 'Uniswap V2'} · ${p.q === WETH ? 'ETH' : 'USDC'}` };
    }).sort((x, y) => y.depthUsd - x.depthUsd);
    const best = rows[0];
    const min = CFG.minDepth || 10000;
    if (best.depthUsd < min) return { ...info, ok: false, pools: rows, priceUsd: best.priceUsd, reason: `Its deepest pool holds ${fmtUsd(best.depthUsd)} of ${best.quote}. A pair needs at least ${fmtUsd(min)} on the ETH or USDC side so its price can't be pushed around cheaply.` };
    return { ...info, ok: true, pools: rows, best, priceUsd: best.priceUsd };
  }
  const fmtUsd = v => '$' + (v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : v.toFixed(0));

  // ------------------------------------------------------------ sample coins
  let tokens = [], byAddr = {};
  function prep(d) {
    const shift = Math.floor(Date.now() / 1000 / 3600) * 3600 - d.generatedAt; // keep the samples current
    for (const x of d.tokens) {
      x.demo = true; x.createdAt += shift; x.chart.t0 += shift;
      for (const e of x.events) e.ts += shift;
      const lag = Date.now() / 1000 - 25 - Math.max(...x.trades.map(t => t.ts)); for (const t of x.trades) t.ts += lag; x.lastTrade = x.trades[0].ts; // newest trade a few seconds ago
      x.backedPct = x.vault ? x.vault.perCoin / x.px * 100 : 0;
      x.toTrigger = x.fund ? (x.fund.trigger / x.px - 1) * 100 : null; // negative: how far the price must fall
      x.burnedUsd = x.events.reduce((s, e) => s + e.usd, 0);
    }
    return d;
  }
  function stats() {
    const all = tokens; const sum = f => all.reduce((s, x) => s + (f(x) || 0), 0);
    return { coins: all.length, vaults: sum(x => x.vault && x.vault.usd), burnedUsd: sum(x => x.burnedUsd), burnedCoins: sum(x => x.burned), funds: sum(x => x.fund && x.fund.usd), vol24: sum(x => x.vol24), holdersPaid: sum(x => x.fees.holders), buybacks: sum(x => x.events.length) };
  }
  // a sample wallet so the portfolio page shows what it tracks before anyone can buy
  function samplePortfolio() {
    const pick = [['FROGR', 2.1e6], ['HARD', 5.4e6], ['DIPS', 9.8e6], ['GOLDF', 3.2e6], ['NVLT', 7.5e6]];
    const rows = pick.map(([s, bal], i) => { const x = tokens.find(t => t.symbol === s); if (!x) return null; const cost = bal * x.px * [0.62, 0.9, 1.18, 0.81, 1.05][i];
      const pending = x.split.holders ? bal / x.circ * x.fees.holders * 0.22 : 0; return { x, bal, cost, value: bal * x.px, floor: x.vault && x.redeem ? bal * x.vault.perCoin : 0, pending }; }).filter(Boolean);
    const created = tokens.find(t => t.symbol === 'DIPS');
    return { address: '0x5a9e…c41d', rows, created: created ? [{ x: created, unclaimed: created.fees.creator * 0.18, earned: created.fees.creator }] : [] };
  }

  const api = {
    cfg: CFG, weth: WETH, usdc: USDC, SUPPLY, prelaunch: !!CFG.prelaunch, demo: !!CFG.demo,
    tokens: () => tokens, token: a => byAddr[lower(a)], known: a => KNOWN[lower(a)], knownList: () => CFG.tokens || [],
    stats, samplePortfolio, ethUsd, gasGwei, checkToken, rpcBatch, isAddress: a => /^0x[0-9a-fA-F]{40}$/.test(a || ''),
    ready: null,
  };
  api.ready = (CFG.demo ? fetch('/demo.json').then(r => r.json()).then(d => { demo = prep(d); tokens = d.tokens; byAddr = Object.fromEntries(tokens.map(x => [x.addr, x])); }) : Promise.resolve())
    .then(() => window.dispatchEvent(new CustomEvent('bs:ready')))
    .catch(e => { console.error(e); window.dispatchEvent(new CustomEvent('bs:ready')); });
  window.BS = api;
})();
