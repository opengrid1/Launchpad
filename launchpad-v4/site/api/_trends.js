// What is trending right now, from free public sources: Google Trends daily searches (US, PH), Wikipedia's most read
// pages, Polymarket's busiest markets, Hacker News' top stories, CoinGecko's trending coins. Each topic gets a stable
// id (source + title) so /api/idea can refuse anything that is not on the current list. Cached for 10 minutes.
const crypto = require('crypto');

const UA = { 'user-agent': 'LiquidFi trends (+https://liquidfi.fun)' };
const get = async (url, type = 'json') => { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(8000) }); if (!r.ok) throw new Error(url + ' ' + r.status); return type === 'json' ? r.json() : r.text(); };
const idOf = (source, title) => crypto.createHash('sha1').update(source + '\n' + title.toLowerCase()).digest('hex').slice(0, 12);
const unxml = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
const tag = (xml, t) => { const m = xml.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)); return m ? unxml(m[1]) : ''; };

async function googleTrends(geo) {
  const xml = await get(`https://trends.google.com/trending/rss?geo=${geo}`, 'text');
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 12).map((m, i) => {
    const it = m[1], title = tag(it, 'title');
    return { source: 'google', label: `Google Trends ${geo}`, title, rank: i + 1, meta: tag(it, 'ht:approx_traffic') ? tag(it, 'ht:approx_traffic') + ' searches' : '', note: tag(it, 'ht:news_item_title'), url: `https://trends.google.com/trends/explore?geo=${geo}&q=${encodeURIComponent(title)}` };
  });
}
async function wikipedia() {
  const skip = /^(Main_Page|Special:|Wikipedia:|Portal:|Help:|File:|Category:|Template:|Talk:|-$|Cleopatra$|XXX|Pornhub|Xvideos|.*_\(film\)$)/;
  for (let back = 1; back <= 3; back++) {
    const d = new Date(Date.now() - back * 86400000), p = (n) => String(n).padStart(2, '0');
    try {
      const j = await get(`https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access/${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())}`);
      return j.items[0].articles.filter((a) => !skip.test(a.article)).slice(0, 12).map((a, i) => ({ source: 'wikipedia', label: 'Wikipedia most read', title: a.article.replace(/_/g, ' '), rank: i + 1, meta: a.views.toLocaleString('en-US') + ' views', note: '', url: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(a.article) }));
    } catch {}
  }
  return [];
}
async function polymarket() {
  const j = await get('https://gamma-api.polymarket.com/events?limit=12&order=volume24hr&ascending=false&closed=false');
  return j.slice(0, 10).map((e, i) => ({ source: 'polymarket', label: 'Polymarket', title: e.title, rank: i + 1, meta: e.volume24hr ? '$' + Math.round(e.volume24hr).toLocaleString('en-US') + ' traded today' : '', note: '', url: 'https://polymarket.com/event/' + e.slug }));
}
async function hackerNews() {
  const ids = (await get('https://hacker-news.firebaseio.com/v0/topstories.json')).slice(0, 10);
  const items = await Promise.all(ids.map((id) => get(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).catch(() => null)));
  return items.filter((x) => x && x.title).map((x, i) => ({ source: 'hackernews', label: 'Hacker News', title: x.title, rank: i + 1, meta: x.score + ' points', note: '', url: 'https://news.ycombinator.com/item?id=' + x.id }));
}
async function coingecko() {
  const j = await get('https://api.coingecko.com/api/v3/search/trending');
  return (j.coins || []).slice(0, 10).map((c, i) => { const it = c.item, ch = it.data && it.data.price_change_percentage_24h && it.data.price_change_percentage_24h.usd; return { source: 'coingecko', label: 'CoinGecko trending', title: `${it.name} (${it.symbol})`, rank: i + 1, meta: ch != null ? (ch >= 0 ? '+' : '') + ch.toFixed(1) + '% today' : '', note: 'A trending coin; suggest something it inspires, not a copy of it.', url: 'https://www.coingecko.com/en/coins/' + it.id }; });
}

const CACHE = { at: 0, data: null, pending: null };
async function trends() {
  if (CACHE.data && Date.now() - CACHE.at < 600000) return CACHE.data;
  if (CACHE.pending) return CACHE.pending;
  CACHE.pending = (async () => {
    const parts = await Promise.allSettled([googleTrends('US'), googleTrends('PH'), wikipedia(), polymarket(), hackerNews(), coingecko()]);
    const topics = [], seen = new Set();
    for (const p of parts) if (p.status === 'fulfilled') for (const t of p.value) { const k = t.title.toLowerCase(); if (!t.title || seen.has(k)) continue; seen.add(k); topics.push({ id: idOf(t.source, t.title), ...t }); }
    const data = { at: Math.floor(Date.now() / 1000), topics, sources: parts.map((p, i) => ({ source: ['google-US', 'google-PH', 'wikipedia', 'polymarket', 'hackernews', 'coingecko'][i], ok: p.status === 'fulfilled', n: p.status === 'fulfilled' ? p.value.length : 0 })) };
    if (topics.length) { CACHE.data = data; CACHE.at = Date.now(); }
    return data;
  })().finally(() => { CACHE.pending = null; });
  return CACHE.pending;
}

module.exports = { trends };
