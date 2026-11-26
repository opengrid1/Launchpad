// Vercel function: tokens trending on Base right now (GeckoTerminal), for the
// launch form's token picker. Only tokens paired with ETH or USDC in a pool deep
// enough to have a chance at the launch check are kept; the form still checks
// every pick on-chain. Cached at the edge for five minutes.
const WETH = '0x4200000000000000000000000000000000000006';
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const MIN_POOL_USD = 25000;

let last = null;

async function fetchTrending() {
  const url = 'https://api.geckoterminal.com/api/v2/networks/base/trending_pools?include=base_token,quote_token&duration=24h&page=1';
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error('geckoterminal ' + r.status);
  const d = await r.json();
  const inc = Object.fromEntries((d.included || []).map((x) => [x.id, x.attributes]));
  const out = new Map();
  for (const p of d.data || []) {
    const a = p.attributes || {}; const rel = p.relationships || {};
    const base = inc[rel.base_token && rel.base_token.data.id] || {}; const quote = inc[rel.quote_token && rel.quote_token.data.id] || {};
    const sides = [[base, quote], [quote, base]];
    for (const [tok, other] of sides) {
      const ta = String(tok.address || '').toLowerCase(), oa = String(other.address || '').toLowerCase();
      if (!ta || ta === WETH || ta === USDC || (oa !== WETH && oa !== USDC)) continue;
      const liq = Number(a.reserve_in_usd || 0); if (liq < MIN_POOL_USD) continue;
      if (out.has(ta) && out.get(ta).liq >= liq) continue;
      const created = Date.parse(a.pool_created_at || '') || 0;
      out.set(ta, {
        symbol: tok.symbol, name: tok.name, address: ta, decimals: Number(tok.decimals || 18),
        logo: tok.image_url && /^https:\/\//.test(tok.image_url) ? tok.image_url : '',
        liq: Math.round(liq), vol24: Math.round(Number((a.volume_usd || {}).h24 || 0)),
        change24: Number((a.price_change_percentage || {}).h24 || 0), isNew: created > Date.now() - 7 * 86400e3,
      });
    }
  }
  return [...out.values()].sort((x, y) => y.vol24 - x.vol24).slice(0, 15);
}

module.exports = async (req, res) => {
  try {
    if (!last || Date.now() - last.at > 240000) last = { at: Date.now(), tokens: await fetchTrending() };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
    res.end(JSON.stringify(last));
  } catch (e) {
    if (last) { res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'public, s-maxage=60'); return res.end(JSON.stringify(last)); }
    res.statusCode = 503; res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ error: String((e && e.message) || e).slice(0, 200) }));
  }
};
