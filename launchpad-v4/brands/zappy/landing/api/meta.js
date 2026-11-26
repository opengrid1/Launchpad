// POST /api/meta {name, ticker, description, image, x, telegram, website}: a coin's metadata as a small JSON file in the
// public Blob store, under its content hash. Its URL goes onchain as the launch's metadataURI; the indexer reads it back
// for the logo, the description and the links.
const crypto = require('crypto');
const Z = require('./_zlib');

const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, n);
const url = (s) => { s = clean(s, 200); if (!s) return ''; if (!/^https?:\/\//i.test(s)) s = 'https://' + s; try { const u = new URL(s); return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : ''; } catch { return ''; } };

module.exports = async (req, res) => {
  if (req.method !== 'POST') return Z.json(res, 405, { error: 'POST' });
  try {
    const b = await Z.readBody(req, 64 * 1024);
    const meta = { name: clean(b.name, 32), ticker: clean(b.ticker, 10), description: clean(b.description, 500), image: url(b.image), x: url(b.x), telegram: url(b.telegram), website: url(b.website) };
    if (!meta.name || !meta.ticker) return Z.json(res, 400, { error: 'name and ticker' });
    const body = JSON.stringify(meta);
    const name = `zappy-floor/meta/${crypto.createHash('sha256').update(body).digest('hex').slice(0, 40)}.json`;
    if (process.env.LOCAL_UPLOAD_DIR) { const fs = require('fs'), path = require('path'); const f = path.join(process.env.LOCAL_UPLOAD_DIR, name); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); return Z.json(res, 200, { url: (process.env.LOCAL_UPLOAD_BASE || '') + '/' + name }); }
    const { put } = require('@vercel/blob');
    const r = await put(name, body, { access: 'public', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 31536000 });
    Z.json(res, 200, { url: r.url });
  } catch (e) { Z.json(res, e.code === 413 ? 413 : 500, { error: e.message }); }
};
