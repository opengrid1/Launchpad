// POST /api/sign {creator, salt, name, ticker}: the start tick for a launch now (a ~$10k market cap in ETH at Chainlink's
// ETH/USD, on the 60-tick grid, inside the factory's start band) signed by the start signer (EIP-712 LaunchStart), good
// for 20 minutes. The factory checks the signature, the band and that a (creator, salt) start is used once.
const Z = require('./_zlib');
const { ethers, NET, multicall, I } = Z;

const SUPPLY = 1e9, MCAP_USD = 10000;
// tokens per ETH that make the whole supply worth MCAP_USD at `ethUsd`, as a tick rounded up the 60-tick grid
function startTick(ethUsd) {
  const ratio = (SUPPLY * ethUsd) / MCAP_USD; // 1e5 x ethUsd
  let t = Math.floor(Math.log(ratio) / Math.log(1.0001));
  const r = ((t % 60) + 60) % 60; if (r !== 0) t = t - r + 60;
  return t;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return Z.json(res, 405, { error: 'POST' });
  try {
    const key = process.env.ZAPPY_START_SIGNER_KEY; if (!key) return Z.json(res, 503, { error: 'start signer not configured' });
    const b = await Z.readBody(req, 16 * 1024);
    const creator = ethers.getAddress(String(b.creator || '')), salt = String(b.salt || '');
    const name = String(b.name || '').trim(), ticker = String(b.ticker || '').trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(salt)) return Z.json(res, 400, { error: 'salt' });
    if (!name || name.length > 32 || !/^[A-Z0-9]{1,10}$/.test(ticker)) return Z.json(res, 400, { error: 'name or ticker' });
    const [round, lowT, highT, paused, signer] = await multicall([[NET.ethUsdFeed, I.feed, 'latestRoundData'], [NET.factory, I.factory, 'startBandLow'], [NET.factory, I.factory, 'startBandHigh'], [NET.factory, I.factory, 'launchesPaused'], [NET.factory, I.factory, 'startSigner']]);
    if (paused) return Z.json(res, 409, { error: 'Launches are paused right now' });
    const wallet = new ethers.Wallet(key);
    if (signer && signer.toLowerCase() !== wallet.address.toLowerCase()) return Z.json(res, 503, { error: 'start signer mismatch' });
    const ethUsd = Number(round[1]) / 1e8;
    let tick = startTick(ethUsd);
    const lo = Number(lowT), hi = Number(highT);
    if (tick < lo) tick = lo; else if (tick > hi) tick = hi; // the band moves with the admin; a start never leaves it
    const deadline = Math.floor(Date.now() / 1000) + 20 * 60;
    const signature = await wallet.signTypedData(
      { name: 'ZappyFactory', version: '1', chainId: 1, verifyingContract: NET.factory },
      { LaunchStart: [{ name: 'creator', type: 'address' }, { name: 'salt', type: 'bytes32' }, { name: 'quote', type: 'address' }, { name: 'name', type: 'string' }, { name: 'ticker', type: 'string' }, { name: 'tickStart', type: 'int24' }, { name: 'deadline', type: 'uint256' }] },
      { creator, salt, quote: ethers.ZeroAddress, name, ticker, tickStart: tick, deadline },
    );
    Z.json(res, 200, { tickStart: tick, deadline, signature, quote: ethers.ZeroAddress, ethUsd });
  } catch (e) { Z.json(res, e.code === 413 ? 413 : 500, { error: e.message }); }
};
module.exports.startTick = startTick;
