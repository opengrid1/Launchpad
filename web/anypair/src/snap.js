// Vercel function: the coin list, trades and pool state, read once on the server
// with the same chain code the pages run, and cached at the edge. Pages draw from
// it at once and then refresh from the chain in the browser, so a visitor never
// waits on free public RPCs before seeing anything.
const cfg = require('./_config.json');
globalThis.window = { ANYPAIR: { ...cfg, server: true }, addEventListener() {}, dispatchEvent() {} };

let AP = null, last = null, pending = null;
const fresh = () => last && Date.now() - last.at < 8000;

module.exports = async (req, res) => {
  try {
    if (!AP) { require('./_chain.js'); AP = globalThis.window.AP; pending = AP.ready.then(() => { last = AP.snapshot(); }).finally(() => { pending = null; }); }
    if (!fresh()) { pending = pending || AP.refresh().then(() => { last = AP.snapshot(); }).finally(() => { pending = null; }); await pending; }
    if (!last || !last.tokens.length) throw new Error('no coins read yet');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=86400');
    res.end(JSON.stringify(last, (k, v) => (typeof v === 'bigint' ? v.toString() : v)));
  } catch (e) {
    res.statusCode = 503;
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ error: String((e && e.message) || e).slice(0, 200) }));
  }
};
