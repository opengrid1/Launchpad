// GET/POST /api/bridge: the any-chain bridge, on SideShift's v2 API. Visitors send BTC, ETH, SOL, USDT or any of
// 200+ coins to a deposit address and receive HYPE on HyperEVM at their own address; nothing to sign. This function
// signs the requests with the account's Ed25519 key (SIDESHIFT_SEED, 32 bytes hex; SIDESHIFT_ACCOUNT is the account
// id) and passes the visitor's IP on, as SideShift requires of server-side integrations. Ops:
//   ?op=coins                      the coin list (cached 10 min), trimmed to what the picker needs
//   ?op=permissions                whether this visitor's region may create shifts
//   ?op=pair&from=btc-bitcoin[&amount=]   rate, min and max for one deposit coin
//   ?op=status&id=                 one shift's state
//   POST {depositCoin, depositNetwork, settleAddress, refundAddress?, refundMemo?}   creates a variable shift
const crypto = require('crypto');

const BASE = 'https://sideshift.ai', SETTLE = { coin: 'hype', network: 'hyperevm' };
const ACCOUNT = process.env.SIDESHIFT_ACCOUNT || '', SEED = process.env.SIDESHIFT_SEED || '';
const COMMISSION = process.env.SIDESHIFT_COMMISSION || ''; // '' keeps SideShift's default (0.5%), included in the rate
let KEY = null, PUB = '';
function key() {
  if (KEY) return KEY;
  if (!/^[0-9a-f]{64}$/i.test(SEED)) throw Object.assign(new Error('The bridge is not configured'), { code: 503 });
  KEY = crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(SEED, 'hex')]), format: 'der', type: 'pkcs8' });
  PUB = crypto.createPublicKey(KEY).export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex');
  return KEY;
}
function signed(method, path, body) {
  const ts = String(Date.now()), sig = crypto.sign(null, Buffer.from(ts + method + path + (body || '')), key()).toString('hex');
  return { 'x-sideshift-key': PUB, 'x-sideshift-timestamp': ts, 'x-sideshift-signature': sig };
}
async function call(method, path, { body, ip, sign } = {}) {
  const headers = { 'content-type': 'application/json', accept: 'application/json' };
  if (ip) headers['x-user-ip'] = ip;
  if (sign) Object.assign(headers, signed(method, path, body));
  const r = await fetch(BASE + path, { method, headers, body });
  const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = { error: { message: text.slice(0, 200) } }; }
  if (!r.ok) throw Object.assign(new Error((json.error && json.error.message) || 'The exchange refused the request'), { code: r.status, detail: json.error });
  return json;
}
const ipOf = (req) => String(req.headers['x-real-ip'] || (req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket?.remoteAddress || '').trim();
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9.-]/g, '').slice(0, 40);

// the coin list: every coin and network that can be deposited, settle side excluded, shaped for the picker
let coinsCache = { at: 0, v: null };
async function coins() {
  if (coinsCache.v && Date.now() - coinsCache.at < 600000) return coinsCache.v;
  const raw = await call('GET', '/api/v2/coins');
  const out = [];
  for (const c of raw) {
    if (c.depositOffline === true) continue; // depositOffline is true, false, or the list of networks that are offline
    for (const n of c.networks || []) {
      if (n === 'internal' || (Array.isArray(c.depositOffline) && c.depositOffline.includes(n))) continue;
      if (c.coin.toLowerCase() === SETTLE.coin && n === SETTLE.network) continue;
      out.push({ coin: c.coin, name: c.name, network: n, memo: (c.networksWithMemo || []).includes(n), fixedOnly: !!c.fixedOnly });
    }
  }
  const TOP = ['BTC', 'ETH', 'SOL', 'USDT', 'USDC', 'BNB', 'XRP', 'LTC', 'DOGE', 'XMR', 'TRX', 'TON', 'AVAX', 'SUI', 'ADA', 'DOT', 'LINK', 'BCH', 'HYPE', 'ARB', 'OP', 'POL', 'APT', 'NEAR', 'KAS', 'ZEC', 'DASH', 'XLM', 'ALGO', 'ATOM'];
  const rank = (c) => { const i = TOP.indexOf(c.coin); return i < 0 ? 999 : i; };
  out.sort((a, b) => rank(a) - rank(b) || a.coin.localeCompare(b.coin) || a.network.localeCompare(b.network));
  coinsCache = { at: Date.now(), v: out }; return out;
}
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = []; let n = 0; for await (const c of req) { n += c.length; if (n > 16384) throw Object.assign(new Error('Too much'), { code: 413 }); chunks.push(c); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

module.exports = async (req, res) => {
  const send = (code, obj, cache) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', cache || 'no-store'); res.end(JSON.stringify(obj)); };
  const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams), ip = ipOf(req);
  try {
    if (!ACCOUNT) throw Object.assign(new Error('The bridge is not configured'), { code: 503 });
    if (req.method === 'POST') {
      const b = await readBody(req);
      const depositCoin = slug(b.depositCoin), depositNetwork = slug(b.depositNetwork), settleAddress = String(b.settleAddress || '').trim();
      if (!depositCoin || !depositNetwork) throw Object.assign(new Error('Choose a coin'), { code: 400 });
      if (!/^0x[0-9a-fA-F]{40}$/.test(settleAddress)) throw Object.assign(new Error('The receiving address must be an EVM address'), { code: 400 });
      const body = { depositCoin, depositNetwork, settleCoin: SETTLE.coin, settleNetwork: SETTLE.network, settleAddress, affiliateId: ACCOUNT };
      if (b.refundAddress) body.refundAddress = String(b.refundAddress).trim().slice(0, 128);
      if (b.refundMemo) body.refundMemo = String(b.refundMemo).trim().slice(0, 64);
      if (COMMISSION) body.commissionRate = COMMISSION;
      const json = JSON.stringify(body), shift = await call('POST', '/api/v2/shifts/variable', { body: json, ip, sign: true });
      return send(201, shift);
    }
    const op = String(q.op || '');
    if (op === 'coins') return send(200, await coins(), 'public, s-maxage=600, stale-while-revalidate=3600');
    if (op === 'permissions') return send(200, await call('GET', '/api/v2/permissions', { ip }));
    if (op === 'pair') {
      const from = slug(q.from); if (!from) throw Object.assign(new Error('Choose a coin'), { code: 400 });
      const amt = q.amount && Number(q.amount) > 0 ? '&amount=' + encodeURIComponent(String(Number(q.amount))) : '';
      const path = `/api/v2/pair/${from}/${SETTLE.coin}-${SETTLE.network}?affiliateId=${ACCOUNT}${amt}${COMMISSION ? '&commissionRate=' + COMMISSION : ''}`;
      return send(200, await call('GET', path, { ip, sign: true }), 'public, s-maxage=10');
    }
    if (op === 'status') {
      const id = String(q.id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40); if (!id) throw Object.assign(new Error('Which bridge?'), { code: 400 });
      return send(200, await call('GET', '/api/v2/shifts/' + id, { ip }));
    }
    return send(400, { error: 'op?' });
  } catch (e) {
    return send(e.code >= 400 && e.code < 600 ? e.code : 502, { error: e.message || 'Bridge error', detail: e.detail });
  }
};
