// POST /api/upload: a token logo (PNG, JPEG, WEBP or GIF, up to 1 MB, sent as a data URL in JSON) stored in the
// public Blob store under its content hash, so the same image always gets the same URL. The URL goes onchain as the
// token's logo. LOCAL_UPLOAD_DIR stores files on disk instead (local tests).
const crypto = require('crypto');
const fs = require('fs'), path = require('path');
const TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const MAX = 1024 * 1024;
const MAGIC = { png: [0x89, 0x50, 0x4e, 0x47], jpg: [0xff, 0xd8, 0xff], gif: [0x47, 0x49, 0x46], webp: [0x52, 0x49, 0x46, 0x46] };

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body);
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > MAX * 1.5) throw Object.assign(new Error('Image is over 1 MB'), { code: 413 }); chunks.push(c); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

module.exports = async (req, res) => {
  const send = (code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store'); res.end(JSON.stringify(obj)); };
  if (req.method !== 'POST') return send(405, { error: 'POST an image' });
  try {
    const body = await readBody(req);
    const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(String(body.data || ''));
    if (!m) return send(400, { error: 'Send a PNG, JPG, WEBP or GIF image' });
    const type = m[1], ext = TYPES[type], buf = Buffer.from(m[2], 'base64');
    if (!buf.length || buf.length > MAX) return send(413, { error: 'Image is over 1 MB' });
    if (!MAGIC[ext].every((b, i) => buf[i] === b)) return send(400, { error: 'The file is not a valid ' + ext.toUpperCase() });
    const name = `logos/${crypto.createHash('sha256').update(buf).digest('hex').slice(0, 40)}.${ext}`;
    if (process.env.LOCAL_UPLOAD_DIR) {
      const f = path.join(process.env.LOCAL_UPLOAD_DIR, name); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf);
      return send(200, { url: (process.env.LOCAL_UPLOAD_BASE || '') + '/' + name });
    }
    const { put } = require('@vercel/blob');
    const r = await put(name, buf, { access: 'public', contentType: type, addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 31536000 });
    return send(200, { url: r.url });
  } catch (e) { return send(e.code === 413 ? 413 : 500, { error: e.code === 413 ? e.message : 'Upload failed' }); }
};
