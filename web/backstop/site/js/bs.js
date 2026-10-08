/* Etherhook data for the pages: the live coins from the chain layer (window.EH, in the wallet
   bundle), platform totals, and a few direct Ethereum reads (ETH price, gas).
   Exposes window.BS and fires 'bs:ready'. No sample data: an empty chain shows empty pages. */
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
  async function ethUsd() {
    try { return await cached('ethUsd', 60000, async () => { const [r] = await rpcBatch([call(CFG.ethUsdFeed, SEL.latestRoundData)]); const a = word(r, 1); if (!a) throw new Error('feed'); return Number(a) / 1e8; }); }
    catch { return 2700; }
  }
  async function gasGwei() { return cached('gas', 30000, async () => { const [g] = await rpcBatch([{ method: 'eth_gasPrice' }]); return Number(BigInt(g)) / 1e9; }); }

  // ------------------------------------------------------------ pair check: what the launch form shows for a backing token
  async function checkToken(addrIn) {
    const a = lower(addrIn);
    if (!/^0x[0-9a-f]{40}$/.test(a)) return { ok: false, reason: 'That is not an Ethereum address.' };
    const r = await window.EH.pairStatus(a); const i = r.info || {}; const known = KNOWN[a] || window.EH.known(a) || {};
    const base = { address: a, symbol: known.symbol || i.symbol || '???', name: known.name || i.name || '', decimals: i.decimals, logo: known.logo || i.logo || '', priceUsd: r.priceUsd, ethRoute: r.ethRoute };
    if (!r.ok) return { ...base, ok: false, pools: [], reason: r.reason };
    return { ...base, ok: true, pools: [], note: `Priced at ${fmtUsd(r.priceUsd)} from ${r.how}.${r.ethRoute ? '' : ' It has no pool to buy it with ETH, so this coin trades in ' + base.symbol + ' itself.'}` };
  }
  const fmtUsd = v => v == null ? '?' : '$' + (v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : v >= 1 ? v.toFixed(2) : v.toPrecision(3));

  // ------------------------------------------------------------ coins (from the chain layer)
  let tokens = [], byAddr = {};
  function take(list) { tokens = list || []; byAddr = Object.fromEntries(tokens.map(x => [x.addr, x])); }
  function stats() {
    const all = tokens; const sum = f => all.reduce((s, x) => s + (f(x) || 0), 0);
    return { coins: all.length, vaults: sum(x => x.vault && x.vault.usd), burnedUsd: sum(x => x.burnedUsd), burnedCoins: sum(x => x.burned), funds: sum(x => x.fund && x.fund.usd), vol24: sum(x => x.vol24), holdersPaid: sum(x => x.fees.holders), buybacks: sum(x => x.events.length) };
  }

  const api = {
    cfg: CFG, weth: WETH, usdc: USDC, SUPPLY, live: !!(CFG.contracts && CFG.contracts.factory),
    tokens: () => tokens, token: a => byAddr[lower(a)], known: a => KNOWN[lower(a)] || (window.EH && window.EH.known(a)), knownList: () => (window.EH ? window.EH.knownList() : CFG.tokens || []),
    stats, ethUsd, gasGwei, checkToken, rpcBatch, isAddress: a => /^0x[0-9a-fA-F]{40}$/.test(a || ''),
    reload: () => window.EH.load().then(take),
    ready: null,
  };
  // the chain layer loads in the wallet bundle, which runs after this file: wait for it
  // (deferred scripts run while readyState is already 'interactive', so only 'complete' means the bundle has run)
  api.ready = new Promise(res => { if (document.readyState === 'complete') res(); else document.addEventListener('DOMContentLoaded', res); })
    .then(() => (window.EH ? window.EH.ready : []))
    .then(take)
    .catch(e => console.error(e))
    .then(() => window.dispatchEvent(new CustomEvent('bs:ready')));
  window.addEventListener('bs:update', () => { if (window.EH) take(window.EH.tokens()); });
  window.BS = api;
})();
