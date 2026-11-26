/* Lootbag log cache (a Vercel function). The site reads coins, trades and payouts from the contracts' logs, and a
   public RPC only serves them a few hours of blocks at a time. This function serves one fixed window of blocks that
   is already in the past, and the CDN in front of it keeps the answer for good, so a visitor reads a long history
   in a few cached requests instead of hundreds of RPC calls. It holds no state and no keys.

   GET /api/logs?kind=platform&from=<block>&size=<45000|450000>
   GET /api/logs?kind=swaps&id=<pool id>&from=...&size=...     a Lootbag coin's pool: its swaps in the PoolManager
   GET /api/logs?kind=xfers&id=<coin address>&from=...&size=... a Lootbag coin: its transfers

   Windows are aligned (from is a multiple of size) and must be closed (well behind the chain head), so an answer can
   never change. Anything else is refused. The site falls back to the RPC itself whenever this does not answer. */
global.window = global.window || {};
require('../lb-config.js');
const C = global.window.LB_CFG, K = C.contracts;
const SPAN = 45000, SIZES = [45000, 450000], CLOSED = 600, MAX_BYTES = 3800000;
const SWAP = '0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f';
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const RPCS = [C.rpc, ...(C.rpcFallbacks || [])];
const hex = (n) => '0x' + n.toString(16);

async function rpc(method, params, urls = RPCS) {
  let last;
  for (let round = 0; round < 3; round++) {
    for (const url of urls) {
      try {
        const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 20000);
        const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: ctl.signal });
        clearTimeout(t);
        const j = await r.json();
        if (j && j.result !== undefined) return j.result;
        last = new Error((j && j.error && j.error.message) || 'rpc status ' + r.status);
      } catch (e) { last = e; }
    }
    await new Promise((res) => setTimeout(res, 400 * (round + 1)));
  }
  throw last;
}
const send = (res, code, body, cache) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', cache); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
const FOREVER = 'public, max-age=86400, s-maxage=31536000, immutable', NEVER = 'no-store';

module.exports = async (req, res) => {
  try {
    const q = req.query || {}, kind = String(q.kind || ''), id = String(q.id || '').toLowerCase(), from = Number(q.from), size = Number(q.size);
    if (!SIZES.includes(size) || !Number.isSafeInteger(from) || from < 0 || from % size !== 0 || from + size <= (C.startBlock || 0)) return send(res, 400, { error: 'bad window' }, NEVER);
    const to = from + size - 1;
    const head = parseInt(await rpc('eth_blockNumber', []), 16);
    if (to > head - CLOSED) return send(res, 409, { error: 'window not closed yet' }, NEVER);

    let filter;
    if (kind === 'platform') filter = { address: [K.factory, K.hook, K.payout, K.router, K.airdrop, K.bags] };
    else if (kind === 'swaps') {
      // only the pool of a Lootbag coin: the hook knows it
      if (!/^0x[0-9a-f]{64}$/.test(id)) return send(res, 400, { error: 'bad pool id' }, NEVER);
      const pool = await rpc('eth_call', [{ to: K.hook, data: '0xb5217bb4' + id.slice(2) }, 'latest']);
      if (!pool || /^0x0{64}/.test(pool)) return send(res, 404, { error: 'not a Lootbag pool' }, NEVER);
      filter = { address: K.poolManager, topics: [SWAP, id] };
    } else if (kind === 'xfers') {
      // only a coin the factory launched
      if (!/^0x[0-9a-f]{40}$/.test(id)) return send(res, 400, { error: 'bad coin' }, NEVER);
      const creator = await rpc('eth_call', [{ to: K.factory, data: '0xdea5c2e0' + id.slice(2).padStart(64, '0') }, 'latest']);
      if (!creator || /^0x0{64}$/.test(creator)) return send(res, 404, { error: 'not a Lootbag coin' }, NEVER);
      filter = { address: id, topics: [TRANSFER] };
    } else return send(res, 400, { error: 'bad kind' }, NEVER);

    // wide log ranges are only served by the first RPC; the others are for the small calls above
    const spans = []; for (let a = from; a <= to; a += SPAN) spans.push([a, Math.min(to, a + SPAN - 1)]);
    const parts = await Promise.all(spans.map(([a, b]) => rpc('eth_getLogs', [{ ...filter, fromBlock: hex(a), toBlock: hex(b) }], [C.rpc])));
    const logs = parts.flat().map((l) => [l.address, l.topics, l.data, parseInt(l.blockNumber, 16), parseInt(l.logIndex, 16), l.transactionHash, l.blockTimestamp ? parseInt(l.blockTimestamp, 16) : 0]);
    const body = JSON.stringify({ from, to, logs });
    // too much for one answer: said once and for all, so the site asks for smaller windows or the RPC itself
    if (body.length > MAX_BYTES) return send(res, 413, { error: 'too large' }, FOREVER);
    return send(res, 200, body, FOREVER);
  } catch (e) {
    return send(res, 502, { error: String((e && e.message) || e).slice(0, 200) }, NEVER);
  }
};
