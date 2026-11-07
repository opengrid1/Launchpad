// GET /api/keeper (Vercel cron every minute where a brand runs leverage, guarded by CRON_SECRET): the liquidation
// keeper for ZappyMargin. On every chain whose v2 block names a margin contract it reads every open position's health
// and then: liquidates flagged positions still past maintenance once the delay has run, flags positions newly past
// it, and clears flags on positions that recovered. Positions it flags in this run are liquidated in the same run
// after the delay if they are still past maintenance. The keeper earns the contract's keeper reward on each
// liquidation. Transactions are signed with SWEEP_KEY, which needs a little ETH for gas.
const { ethers, NETS, rpc, multicall, sendTx, sleep } = require('./_lib');

const MI = new ethers.Interface([
  'function nextId() view returns (uint256)', 'function liquidationDelay() view returns (uint256)',
  'function positions(uint256) view returns (address owner, address token, uint256 tokens, uint256 principal, uint256 margin, uint40 openedAt, uint40 flaggedAt, uint32 leverageBps)',
  'function health(uint256 id) view returns (uint256 debt, uint256 value, bool liquidatable)',
  'function flag(uint256 id)', 'function liquidate(uint256 id)',
]);

async function readOpen(NET, M, ids) {
  const r = await multicall(NET, ids.flatMap((id) => [[M, MI, 'positions', [id]], [M, MI, 'health', [id]]]));
  return ids.map((id, i) => ({ id, p: r[i * 2], h: r[i * 2 + 1] })).filter((x) => x.p && x.p.owner !== ethers.ZeroAddress && x.h);
}

async function keepChain(NET, wallet, until) {
  const M = NET.v2.margin;
  const [next, delayRaw] = await multicall(NET, [[M, MI, 'nextId'], [M, MI, 'liquidationDelay']]);
  const delay = Number(delayRaw || 15n), ids = []; for (let i = 1n; i < (next || 1n); i++) ids.push(i);
  if (!ids.length) return { open: 0 };
  const chainNow = async () => parseInt((await rpc(NET, 'eth_getBlockByNumber', ['latest', false])).timestamp, 16);
  let open = await readOpen(NET, M, ids), t = await chainNow();
  const done = { liquidated: [], flagged: [], cleared: [], errors: [] };
  const tx = async (fn, id) => { const r = await sendTx(NET, wallet, { to: M, data: MI.encodeFunctionData(fn, [id]), gasLimit: fn === 'liquidate' ? 2_000_000n : 200_000n }).catch((e) => ({ error: e.shortMessage || e.message })); if (r.error || r.status === 0) done.errors.push({ fn, id: Number(id), error: r.error || 'reverted' }); else (fn === 'liquidate' ? done.liquidated : done.flagged).push(Number(id)); return r; };
  for (const x of open.filter((x) => x.h[2] && Number(x.p.flaggedAt) > 0 && t >= Number(x.p.flaggedAt) + delay)) await tx('liquidate', x.id);
  const fresh = open.filter((x) => x.h[2] && Number(x.p.flaggedAt) === 0);
  for (const x of fresh) await tx('flag', x.id);
  for (const x of open.filter((x) => !x.h[2] && Number(x.p.flaggedAt) > 0)) { const r = await sendTx(NET, wallet, { to: M, data: MI.encodeFunctionData('flag', [x.id]), gasLimit: 200_000n }).catch((e) => ({ error: e.message })); if (!r.error) done.cleared.push(Number(x.id)); }
  // positions flagged in this run: wait out the delay and liquidate those still past maintenance
  if (fresh.length && Date.now() + (delay + 3) * 1000 < until) {
    await sleep((delay + 2) * 1000);
    open = await readOpen(NET, M, fresh.map((x) => x.id)); t = await chainNow();
    for (const x of open.filter((x) => x.h[2] && Number(x.p.flaggedAt) > 0 && t >= Number(x.p.flaggedAt) + delay)) await tx('liquidate', x.id);
  }
  return { open: (await readOpen(NET, M, ids)).length, ...done };
}

module.exports = async (req, res) => {
  const send = (code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store'); res.end(JSON.stringify(obj)); };
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== 'Bearer ' + secret) return send(401, { error: 'unauthorized' });
  const key = process.env.SWEEP_KEY; if (!key) return send(500, { error: 'SWEEP_KEY is not set' });
  const wallet = new ethers.Wallet(key.startsWith('0x') ? key : '0x' + key), out = {}, until = Date.now() + 50_000;
  for (const NET of Object.values(NETS)) {
    if (!NET.v2 || !NET.v2.margin) continue;
    try { out[NET.key] = await keepChain(NET, wallet, until); } catch (e) { out[NET.key] = { error: e.message }; }
  }
  return send(200, out);
};
