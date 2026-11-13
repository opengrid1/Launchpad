// POST /api/sign {chain, creator, salt, name, ticker}: the start tick for a launch on `chain` now (a ~$10k market cap at
// Hyperliquid's HYPE price, on the 60-tick grid, inside the factory's start band) signed by the start signer (EIP-712
// LaunchStart for that chain's factory), good for 20 minutes. The factory checks the signature, the band and that a
// (creator, salt) start is used once. The launch service signs the coin's leg on the other chain the same way (api/leg).
const X = require('./_hx');
const { ethers, NETS } = X;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return X.json(res, 405, { error: 'POST' });
  try {
    const b = await X.readBody(req, 16 * 1024);
    const N = NETS[b.chain]; if (!N || !N.live) return X.json(res, 400, { error: 'chain' });
    const creator = ethers.getAddress(String(b.creator || '')), salt = String(b.salt || '');
    const name = String(b.name || '').trim(), ticker = String(b.ticker || '').trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(salt)) return X.json(res, 400, { error: 'salt' });
    if (!name || name.length > 32 || !/^[A-Z0-9]{1,10}$/.test(ticker)) return X.json(res, 400, { error: 'name or ticker' });
    X.json(res, 200, await X.signStart(N.key, { creator, salt, name, ticker }));
  } catch (e) { X.json(res, e.code === 413 || e.code === 409 || e.code === 503 ? e.code : 500, { error: e.message }); }
};
