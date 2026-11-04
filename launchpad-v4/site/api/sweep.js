// GET /api/sweep (Vercel cron, guarded by CRON_SECRET): the fee keeper, on every chain. For every LiquidFi pool holding unswept fees,
// the fee sweep operator calls hook.sweepPoolFees, which converts token fees to HYPE (capped by the hook's max price
// impact) and credits the creator and protocol in the fee escrow. Transactions are signed with SWEEP_KEY; on Elysium
// they are posted to its inbox on HyperEVM, so the busy public RPC relay is not in the way.
const { ethers, NETS, rpc, multicall, sendTx } = require('./_lib');
const state = require('./state');

const QI = new ethers.Interface(['function quoteExactInputSingle(((address,address,uint24,int24,address) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut, uint256 gasEstimate)']);
// what the pool would pay for an exact input now (the quoter simulates the swap, hook fees included, so it is conservative)
async function quote(NET, token, zeroForOne, amount) {
  if (amount <= 0n) return 0n;
  const key = [ethers.ZeroAddress, ethers.getAddress(token), 0, 200, NET.hook];
  try { const r = await rpc(NET, 'eth_call', [{ to: NET.quoter, data: QI.encodeFunctionData('quoteExactInputSingle', [[key, zeroForOne, amount, '0x']]) }, 'latest']); return QI.decodeFunctionResult('quoteExactInputSingle', r)[0]; } catch { return 0n; }
}
const HOOK_I = new ethers.Interface(['function pendingFees(bytes32,address) view returns (uint256)', 'function pendingCreatorTax(bytes32,address) view returns (uint256)', 'function pendingBuyback(bytes32,address) view returns (uint256)', 'function feeSweepOperator() view returns (address)', 'function sweepPoolFees(bytes32 poolId, uint256 minConversionQuoteOut, uint256 minBuybackTokensOut)']);
const MIN_HYPE = ethers.parseEther(process.env.SWEEP_MIN_HYPE || '0.002'); // skip pools whose fees are worth less

async function sweepChain(NET, wallet) {
  const [op] = await multicall(NET, [[NET.hook, HOOK_I, 'feeSweepOperator']]);
  if (!op || op.toLowerCase() !== wallet.address.toLowerCase()) return { skipped: 'this key is not the fee sweep operator', operator: op };
  const X = state.indexer(NET.key); await X.sync(); const S = X.build();
  const pools = S.tokens.map((t) => ({ poolId: t.poolId, token: t.addr, buyback: t.buyback, px: t.sqrtP ? 1 / (Number(t.sqrtP) / 2 ** 96) ** 2 : 0 }));
  if (!pools.length) return { pools: 0, due: 0, swept: [] };
  const Z = ethers.ZeroAddress, r = await multicall(NET, pools.flatMap((p) => [[NET.hook, HOOK_I, 'pendingFees', [p.poolId, p.token]], [NET.hook, HOOK_I, 'pendingFees', [p.poolId, Z]], [NET.hook, HOOK_I, 'pendingCreatorTax', [p.poolId, p.token]], [NET.hook, HOOK_I, 'pendingCreatorTax', [p.poolId, Z]], [NET.hook, HOOK_I, 'pendingBuyback', [p.poolId, p.token]], [NET.hook, HOOK_I, 'pendingBuyback', [p.poolId, Z]]]));
  const due = pools.map((p, i) => { const [ft, fh, tt, th, bt, bh] = r.slice(6 * i, 6 * i + 6).map((v) => v || 0n); const worth = fh + th + BigInt(Math.floor(Number(ft + tt) * p.px)); return { ...p, ft, tt, bt, bh, worth }; }).filter((p) => p.worth >= (NET.minSweep && !process.env.SWEEP_MIN_HYPE ? ethers.parseEther(NET.minSweep) : MIN_HYPE));
  const done = [];
  for (const p of due.slice(0, 20)) {
    // minimums the hook insists on: the token fees' conversion to HYPE (5% slack) and, when buyback is on, the tokens
    // its HYPE buys back (loose, 50%); the hook also caps the internal swaps' price impact
    const conv = await quote(NET, p.token, false, p.ft + p.tt), minConv = conv > 0n ? (conv * 95n) / 100n : 1n;
    const bbHype = p.bh + (p.ft + p.tt > 0n && p.ft > 0n ? (conv * p.bt) / (p.ft + p.tt) : 0n);
    const bbTok = p.buyback && bbHype > 0n ? await quote(NET, p.token, true, bbHype) : 0n, minBb = bbTok > 0n ? bbTok / 2n : 1n;
    const out = await sendTx(NET, wallet, { to: NET.hook, data: HOOK_I.encodeFunctionData('sweepPoolFees', [p.poolId, minConv, minBb]), gasLimit: 1200000n }).catch((e) => ({ error: e.message }));
    done.push({ token: p.token, worthHype: ethers.formatEther(p.worth), minConversion: ethers.formatEther(minConv), ...out });
  }
  return { pools: pools.length, due: due.length, swept: done };
}

module.exports = async (req, res) => {
  const send = (code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store'); res.end(JSON.stringify(obj)); };
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== 'Bearer ' + secret) return send(401, { error: 'unauthorized' });
  const key = process.env.SWEEP_KEY; if (!key) return send(500, { error: 'SWEEP_KEY is not set' });
  const wallet = new ethers.Wallet(key.startsWith('0x') ? key : '0x' + key), out = {};
  for (const NET of Object.values(NETS)) { try { out[NET.key] = await sweepChain(NET, wallet); } catch (e) { out[NET.key] = { error: e.message }; } }
  return send(200, out);
};
