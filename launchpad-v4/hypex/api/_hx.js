// Shared by Hypex's API functions: its two chains (Elysium and HyperEVM, every coin on both, HYPE-paired, the same
// addresses on each), a JSON-RPC client per chain that rotates endpoints and rides out rate limits, Multicall3 reads,
// a coin's pool key and id, and the HYPE price from Hyperliquid. Contract addresses come from the deployment files
// (hypex-eth/deployments/<chain>.json), copied into HYPEX_CONTRACTS_<CHAIN> at deploy time; until then the API reports
// that the contracts aren't live yet.
const { ethers } = require('ethers');

const E = process.env;
const parse = (s) => { try { return JSON.parse(s || '{}'); } catch { return {}; } };
const NETS = {
  elysium: {
    key: 'elysium', name: 'Elysium', chainId: 99901, whChain: 74, arbitrum: true,
    rpcs: [...(E.ELYSIUM_RPC ? [E.ELYSIUM_RPC] : []), 'https://rpc.elysium.kinetiq.xyz', 'https://rpc-live.elysp.com'],
    poolManager: '0xE2e105d3F7209A9DA11f83cCf3E7398a753823F1', router: '0xA13f7611115752DEB2B13813BDDE16A5073e4b45',
    quoter: '0x379F556c5a748BD7Cc9baF0F7A344094Ac1814f5', wormhole: '0xC8aD24fC6063c41cB5C12a8e3851AafC3b3CF027',
    ...parse(E.HYPEX_CONTRACTS_ELYSIUM),
  },
  hyperevm: {
    key: 'hyperevm', name: 'HyperEVM', chainId: 999, whChain: 47, arbitrum: false,
    rpcs: [...(E.HYPEREVM_RPC ? [E.HYPEREVM_RPC] : []), 'https://rpc.hyperliquid.xyz/evm', 'https://hyperliquid.drpc.org'],
    poolManager: '0x12D4Fd9C5DeDd00ab8a0bCe2CF0167bbf94b6B1F', router: '0x9aFe3C497e19501DB228F28CdBdD29bC98F65DBa',
    quoter: '0x108Bfe38532C98f8Cd8D7Ab49c9dDAa3675a1c5e', wormhole: '0x7C0faFc4384551f063e05aee704ab943b8B53aB3',
    ...parse(E.HYPEX_CONTRACTS_HYPEREVM),
  },
};
for (const n of Object.values(NETS)) {
  if (E.HYPEX_RPC_ONLY) n.rpcs = n.rpcs.slice(0, 1); // tests: the local node only, never a public fallback
  n.multicall = '0xcA11bde05977b3631167028862bE2a173976CA11'; n.permit2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
  n.spacing = 60; n.fromBlock = Number(n.fromBlock || 0); n.live = !!(n.factory && n.hook && n.bridge);
}
const netOf = (k) => NETS[k] || null;
const otherNet = (k) => (k === 'elysium' ? NETS.hyperevm : NETS.elysium);
const netByWh = (id) => Object.values(NETS).find((n) => n.whChain === Number(id)) || null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cursors = {};
let rid = 0;
// one call on `net`: tries each endpoint in turn, backing off on rate limits; a revert or a bad request is thrown at once
async function rpc(net, method, params, tries = 8) {
  let last = '';
  const N = typeof net === 'string' ? NETS[net] : net, c = cursors[N.key] || 0;
  for (let i = 0; i < tries; i++) {
    const url = N.rpcs[(c + i) % N.rpcs.length];
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method, params }), signal: AbortSignal.timeout(12000) });
      const j = await r.json().catch(() => null);
      if (j && !j.error) { cursors[N.key] = (c + i) % N.rpcs.length; return j.result; }
      last = (j && j.error && j.error.message) || 'HTTP ' + r.status;
      const skip = (j && j.error && (j.error.code === -32601 || j.error.code === -32001)) || /rate|limit|busy|not ready|timed out|timeout|unavailable|archive|range|not supported|method not found|beyond current head/i.test(last);
      if (j && j.error && !skip) { const e = new Error(last); e.data = j.error.data; throw e; }
    } catch (e) { if (e.data !== undefined) throw e; last = e.message; if (!/rate|limit|busy|not ready|timed out|timeout|unavailable|fetch|abort|HTTP|archive|range|JSON|not supported|method not found|beyond current head/i.test(last)) throw e; }
    await sleep(Math.min(4000, 300 * 2 ** i) + Math.random() * 200);
  }
  throw new Error(N.name + ' RPC unavailable: ' + last);
}

const MC = new ethers.Interface(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) view returns ((bool success,bytes returnData)[])']);
// calls: [address, Interface, fn, args]; decoded results in order (single values unwrapped), null for a failed call
async function multicall(net, calls) {
  const N = typeof net === 'string' ? NETS[net] : net, out = [];
  for (let i = 0; i < calls.length; i += 120) {
    const part = calls.slice(i, i + 120);
    const data = MC.encodeFunctionData('aggregate3', [part.map(([t, I, f, a]) => [t, true, I.encodeFunctionData(f, a || [])])]);
    const [res] = MC.decodeFunctionResult('aggregate3', await rpc(N, 'eth_call', [{ to: N.multicall, data }, 'latest']));
    res.forEach(([ok, rd], k) => { if (!ok) return out.push(null); try { const r = part[k][1].decodeFunctionResult(part[k][2], rd); out.push(r.length === 1 ? r[0] : r); } catch { out.push(null); } });
  }
  return out;
}

const AC = ethers.AbiCoder.defaultAbiCoder();
const keyOf = (net, token) => [ethers.ZeroAddress, ethers.getAddress(token), 0, 60, NETS[net].hook];
const poolIdOf = (net, token) => ethers.keccak256(AC.encode(['address', 'address', 'uint24', 'int24', 'address'], keyOf(net, token)));

const LAUNCH_START = [{ name: 'creator', type: 'address' }, { name: 'salt', type: 'bytes32' }, { name: 'quote', type: 'address' }, { name: 'name', type: 'string' }, { name: 'ticker', type: 'string' }, { name: 'tickStart', type: 'int24' }, { name: 'deadline', type: 'uint256' }];
const LP = '(string name,string ticker,string metadataURI,bytes32 salt,address quote,uint256 devBuyTokens,uint256 devBuyMaxCost,int24 tickStart,uint256 deadline,bytes signature,uint8 vestMonths)';
const I = {
  factory: new ethers.Interface([`function launch(${LP} lp) payable returns (address token, bytes32 poolId)`, `function launchLeg(${LP} lp, address creator) payable returns (address token, bytes32 poolId)`, 'function startBandLow() view returns (int24)', 'function startBandHigh() view returns (int24)', 'function launchFeeEth() view returns (uint256)', 'function launchesPaused() view returns (bool)', 'function startSigner() view returns (address)', 'function startUsed(address,bytes32) view returns (bool)', 'function predictToken(address creator, bytes32 salt, string name, string ticker) view returns (address)', 'event TokenLaunched(address indexed token, bytes32 indexed poolId, address indexed creator, address quote, int24 tickStart, uint256 devBuyTokens, string name, string ticker, string metadataURI)']),
  hook: new ethers.Interface(['function floorOf((address,address,uint24,int24,address) key) view returns (int24 tickF, uint160 sqrtPriceX96, uint256 circulating)', 'function pools(bytes32) view returns (address token,address creator,uint40 launchedAt,int24 tickStart,int24 tickF,int24 refTick,uint64 refBlock,uint64 lastRaiseBlock,uint128 snipePot,uint128 snipeReleased,uint8 merged,uint128 liqBand,uint256 pot,uint256 creatorOwed,uint256 reserve,int24 tickB)']),
  pm: new ethers.Interface(['function extsload(bytes32 slot) view returns (bytes32)']),
  erc20: new ethers.Interface(['function totalSupply() view returns (uint256)', 'function balanceOf(address) view returns (uint256)']),
  revenue: new ethers.Interface(['function owed(address,address) view returns (uint256)', 'event Airdropped(address indexed trader, address indexed currency, uint256 amount)', 'event RevenueClaimed(address indexed account, address indexed currency, uint256 amount)']),
  bridge: new ethers.Interface(['function receiveMessage(bytes vaa) payable', 'function releaseFloor(address to, uint256 amount)', 'function floorOut() view returns (uint256)', 'function floorOwed(address) view returns (uint256)', 'function consumed(bytes32) view returns (bool)', 'event Sent(address indexed token, address indexed from, address to, uint16 indexed toChain, uint256 amount, uint256 floorHype, uint64 sequence)', 'event Received(address indexed token, address indexed to, uint16 indexed fromChain, uint256 amount, uint256 floorHype, bytes32 hash)']),
};

// HYPE in USD, from Hyperliquid's mids (cached a few seconds)
let hypeUsd = { v: 0, at: 0 };
async function hypePrice() {
  if (Date.now() - hypeUsd.at < 10000 && hypeUsd.v) return hypeUsd.v;
  try {
    const r = await fetch('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'allMids' }), signal: AbortSignal.timeout(6000) });
    const j = await r.json(); const v = Number(j.HYPE); if (v > 0) hypeUsd = { v, at: Date.now() };
  } catch {}
  return hypeUsd.v;
}

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

// the start tick for a ~$10k market cap (the whole 1B supply on one chain) at `hypeUsd`, rounded up the 60-tick grid
const SUPPLY = 1e9, MCAP_USD = 10000;
function startTick(hypeUsd) {
  let t = Math.floor(Math.log((SUPPLY * hypeUsd) / MCAP_USD) / Math.log(1.0001));
  const r = ((t % 60) + 60) % 60; if (r !== 0) t = t - r + 60;
  return t;
}
// a start signed for `net` (EIP-712 LaunchStart on that chain's factory), inside its start band, good for 20 minutes
async function signStart(net, { creator, salt, name, ticker }) {
  const N = NETS[net], key = E.HYPEX_START_SIGNER_KEY; if (!key) throw Object.assign(new Error('start signer not configured'), { code: 503 });
  const [lowT, highT, paused, signer] = await multicall(N, [[N.factory, I.factory, 'startBandLow'], [N.factory, I.factory, 'startBandHigh'], [N.factory, I.factory, 'launchesPaused'], [N.factory, I.factory, 'startSigner']]);
  if (paused) throw Object.assign(new Error('Launches are paused right now'), { code: 409 });
  const wallet = new ethers.Wallet(key);
  if (signer && signer.toLowerCase() !== wallet.address.toLowerCase()) throw Object.assign(new Error('start signer mismatch'), { code: 503 });
  const px = await hypePrice(); if (!px) throw Object.assign(new Error('HYPE price unavailable'), { code: 503 });
  let tick = startTick(px); const lo = Number(lowT), hi = Number(highT);
  if (tick < lo) tick = lo; else if (tick > hi) tick = hi;
  const deadline = Math.floor(Date.now() / 1000) + 20 * 60;
  const signature = await wallet.signTypedData({ name: 'HypexFactory', version: '1', chainId: N.chainId, verifyingContract: N.factory }, { LaunchStart: LAUNCH_START }, { creator, salt, quote: ethers.ZeroAddress, name, ticker, tickStart: tick, deadline });
  return { tickStart: tick, deadline, signature, quote: ethers.ZeroAddress, hypeUsd: px };
}

module.exports = { ethers, NETS, netOf, otherNet, netByWh, rpc, multicall, keyOf, poolIdOf, I, LP, json, readBody, sleep, hypePrice, startTick, signStart };
