// GET /api/idea?id=<topic id>: a meme token idea (name, ticker, description, SVG logo) for one of the current trending
// topics, written by Claude. Only ids on the current /api/trends list are accepted, so nobody can spend tokens on
// arbitrary prompts; each idea is stored in the Blob store and served from there afterwards (one generation per topic,
// and the CDN caches the answer). Without ANTHROPIC_API_KEY, or when the model declines, a plain idea is built from the
// topic's words and the page draws its standard letter logo.
const Anthropic = require('@anthropic-ai/sdk').default;
const { z } = require('zod');
const { betaZodOutputFormat } = require('@anthropic-ai/sdk/helpers/beta/zod');
const { trends } = require('./_trends');

const MODEL = 'claude-opus-5-5';
const Idea = z.object({
  suitable: z.boolean(),
  reason: z.string(),
  name: z.string(),
  ticker: z.string(),
  description: z.string(),
  logo_svg: z.string(),
});
const SYSTEM = `You come up with meme token concepts for LiquidFi, a token launchpad. Given one trending topic, invent one playful meme token that the topic inspires.

Rules for the token:
- name: 3 to 32 characters, catchy and original. Never a real person's name, a company, product or brand name, or another crypto project's name or ticker; riff on the idea instead.
- ticker: 2 to 8 characters, letters and digits only, uppercase.
- description: one or two sentences, at most 200 characters, fun and self-aware. No links, no URLs, no handles, no price predictions, no promises of returns, no financial advice.
- logo_svg: a square logo as a single self-contained SVG: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">...</svg>. A bold, simple mascot or emblem built from basic shapes and paths, flat colors or gradients, a solid or gradient background filling the square, readable at 48 px. No text in the logo. No <script>, no <image>, no <foreignObject>, no event attributes, no external references (only #id references). Under 6000 characters.

Set suitable to false, with a short reason, when no tasteful meme can be made from the topic: deaths, tragedies, disasters, violence, crime victims, illness, minors, sexual content, hate, or a topic that is only a real private person. Otherwise set suitable to true and reason to an empty string.`;

const clean = (s, n) => String(s || '').replace(/(https?:\/\/|www\.)\S*/gi, '').replace(/\s+/g, ' ').trim().slice(0, n);
function safeSvg(svg) {
  const s = String(svg || '').trim();
  if (s.length > 12000 || !/^<svg[\s>][\s\S]*<\/svg>$/i.test(s)) return '';
  if (/<script|<image|<foreignObject|<iframe|<audio|<video|\son\w+\s*=|javascript:|data:|@import|url\(\s*['"]?(?!#)/i.test(s)) return '';
  if (/(?:xlink:)?href\s*=\s*["'](?!#)/i.test(s)) return '';
  return s;
}
// the plain idea: the topic's own words, a ticker from its letters, the page's letter logo
function plainIdea(t) {
  const words = t.title.replace(/\(.*?\)/g, '').replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 1).slice(0, 3);
  const name = clean(words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ') || 'Trend', 32);
  const ticker = (words.join('').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'TREND').slice(0, 6);
  return { suitable: true, reason: '', name, ticker, description: clean(`The ${name} meme, launched while everyone is talking about it.`, 200), logo_svg: '', ai: false };
}

async function stored(id) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  try { const { head } = require('@vercel/blob'); const h = await head(`ideas/${id}.json`); return await (await fetch(h.url, { cache: 'no-store' })).json(); } catch { return null; }
}
async function store(id, idea) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  try { const { put } = require('@vercel/blob'); await put(`ideas/${id}.json`, JSON.stringify(idea), { access: 'public', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true }); } catch (e) { console.warn('idea store', e.message); }
}

async function generate(t) {
  const client = new Anthropic();
  const topic = `Trending on ${t.label}${t.meta ? ` (${t.meta})` : ''}: ${t.title}${t.note ? `\nContext: ${t.note}` : ''}`;
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: betaZodOutputFormat(Idea) },
    system: SYSTEM,
    messages: [{ role: 'user', content: topic }],
  });
  if (response.stop_reason === 'refusal' || !response.parsed_output) return { ...plainIdea(t), suitable: false, reason: 'No idea for this topic.' };
  const o = response.parsed_output;
  return { suitable: !!o.suitable, reason: clean(o.reason, 140), name: clean(o.name, 32), ticker: clean(o.ticker, 10).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10), description: clean(o.description, 256), logo_svg: safeSvg(o.logo_svg), ai: true };
}

const MEM = new Map();
module.exports = async (req, res) => {
  const send = (code, obj, cache) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', cache || 'no-store'); res.end(JSON.stringify(obj)); };
  try {
    const id = String((req.query && req.query.id) || new URL(req.url || '/', 'http://x').searchParams.get('id') || '').replace(/[^0-9a-f]/g, '').slice(0, 12);
    if (id.length !== 12) return send(400, { error: 'unknown topic' });
    if (MEM.has(id)) return send(200, MEM.get(id), 'public, max-age=0, s-maxage=86400');
    const saved = await stored(id); if (saved) { MEM.set(id, saved); return send(200, saved, 'public, max-age=0, s-maxage=86400'); }
    const t = (await trends()).topics.find((x) => x.id === id);
    if (!t) return send(404, { error: 'This topic is no longer trending' });
    let idea;
    if (process.env.ANTHROPIC_API_KEY) {
      try { idea = await generate(t); } catch (e) { console.warn('idea', e.message); return send(200, { ...plainIdea(t), topic: t.title }, 'no-store'); } // a failed call is not stored
    } else idea = plainIdea(t);
    idea = { ...idea, topic: t.title, source: t.label, id };
    if (idea.ai) { MEM.set(id, idea); await store(id, idea); }
    return send(200, idea, idea.ai ? 'public, max-age=0, s-maxage=86400' : 'no-store');
  } catch (e) { return send(500, { error: 'Idea failed' }); }
};
