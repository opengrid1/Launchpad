// Shared by the API functions: the Zappy floor stack on Ethereum mainnet (deployments/zappy-floor-ethereum.json), a
// JSON-RPC client that rotates across public endpoints and rides out their rate limits, Multicall3 reads, and the pool
// key / id of a coin's ETH pool.
const { ethers } = require('ethers');

const E = process.env;
const NET = {
  key: 'ethereum', name: 'Ethereum', chainId: 1,
  rpcs: [...(E.ETH_RPC ? [E.ETH_RPC] : []), 'https://ethereum-rpc.publicnode.com', 'https://rpc.mevblocker.io', 'https://rpc.flashbots.net'],
  factory: '0xeE2D9c1b5a5bb1B742746888956476FBF78097e5',
  hook: '0x0ccaD7b1035c7eDd95201ED8737dBC29eEA868eC',
  revenue: '0xd1A0021055ed53f06c8D9A715D67f7053FfaF847',
  limitOrders: '0xd9f5717DA70Fd5464352Ddd66c7d7D6B2513746e',
  burner: '0xd0b28a369024870a547d273503a5bB6Eb1608E03',
  vesting: '0x2bd0844E2D0CfeDF44bDDa92fA78C4283fe5A0af',
  zappy: '0xB1c323BdD0caa8013027fc61DA2bFB12dfDe7bb0',
  owner: '0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b',
  poolManager: '0x000000000004444c5dc75cB358380D2e3dE08A90',
  stateView: '0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227',
  quoter: '0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203',
  router: '0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af',
  permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  multicall: '0xcA11bde05977b3631167028862bE2a173976CA11',
  ethUsdFeed: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
  fromBlock: Number(E.ETH_FROM_BLOCK || 26371178), // the factory's deploy block
  spacing: 60,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let rid = 0, cursor = 0;
// one call: tries each endpoint in turn, backing off on rate limits; a revert or a bad request is thrown at once
async function rpc(method, params, tries = 8) {
  let last = '';
  for (let i = 0; i < tries; i++) {
    const url = NET.rpcs[(cursor + i) % NET.rpcs.length];
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method, params }), signal: AbortSignal.timeout(12000) });
      const j = await r.json().catch(() => null);
      if (j && !j.error) { cursor = (cursor + i) % NET.rpcs.length; return j.result; }
      last = (j && j.error && j.error.message) || 'HTTP ' + r.status;
      if (j && j.error && !/rate|limit|busy|not ready|timed out|unavailable|archive|plan|usage|range/i.test(last)) { const e = new Error(last); e.data = j.error.data; throw e; }
    } catch (e) { if (e.data !== undefined) throw e; last = e.message; if (!/rate|limit|busy|not ready|timed out|unavailable|fetch|abort|HTTP|archive|plan|usage|range|JSON/i.test(last)) throw e; }
    await sleep(Math.min(4000, 300 * 2 ** i) + Math.random() * 200);
  }
  throw new Error('Ethereum RPC unavailable: ' + last);
}

const MC = new ethers.Interface(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) view returns ((bool success,bytes returnData)[])']);
// calls: [address, Interface, fn, args]; decoded results in order (single values unwrapped), null for a failed call
async function multicall(calls) {
  const out = [];
  for (let i = 0; i < calls.length; i += 120) {
    const part = calls.slice(i, i + 120);
    const data = MC.encodeFunctionData('aggregate3', [part.map(([t, I, f, a]) => [t, true, I.encodeFunctionData(f, a || [])])]);
    const [res] = MC.decodeFunctionResult('aggregate3', await rpc('eth_call', [{ to: NET.multicall, data }, 'latest']));
    res.forEach(([ok, rd], k) => { if (!ok) return out.push(null); try { const r = part[k][1].decodeFunctionResult(part[k][2], rd); out.push(r.length === 1 ? r[0] : r); } catch { out.push(null); } });
  }
  return out;
}

const AC = ethers.AbiCoder.defaultAbiCoder();
const keyOf = (token) => [ethers.ZeroAddress, ethers.getAddress(token), 0, NET.spacing, NET.hook];
const poolIdOf = (token) => ethers.keccak256(AC.encode(['address', 'address', 'uint24', 'int24', 'address'], keyOf(token)));

const I = {
  factory: new ethers.Interface(['function startBandLow() view returns (int24)', 'function startBandHigh() view returns (int24)', 'function launchFeeEth() view returns (uint256)', 'function devBuyMax() view returns (uint256)', 'function launchesPaused() view returns (bool)', 'function startSigner() view returns (address)', 'function zappy() view returns (address)']),
  hook: new ethers.Interface(['function floorOf((address,address,uint24,int24,address) key) view returns (int24 tickF, uint160 sqrtPriceX96, uint256 circulating)', 'function startOfBlockTick(bytes32) view returns (int24)']),
  stateView: new ethers.Interface(['function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)']),
  erc20: new ethers.Interface(['function totalSupply() view returns (uint256)', 'function balanceOf(address) view returns (uint256)']),
  feed: new ethers.Interface(['function latestRoundData() view returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80)']),
};

function json(res, code, obj, cache) {
  res.statusCode = code; res.setHeader('content-type', 'application/json'); res.setHeader('access-control-allow-origin', '*');
  res.setHeader('cache-control', cache || 'no-store'); res.end(JSON.stringify(obj));
}
async function readBody(req, max = 1024 * 1024) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body);
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > max) throw Object.assign(new Error('Body too large'), { code: 413 }); chunks.push(c); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

module.exports = { ethers, NET, rpc, multicall, keyOf, poolIdOf, I, json, readBody, sleep };
