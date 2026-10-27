// The Equo v2 launch service, behind /api/v2/* (api/index.mjs routes here before the indexer).
//
//   POST /api/v2/quote     a signed snapshot for a new coin: its metadata stored under a content id, one leg per
//                          chosen chain (each leg's salt mined so the coin's address ends in e9), every chain's
//                          native price, and the launch fee that pays the service's gas on the other chains.
//   POST /api/v2/complete  after the creator's own leg is mined: the service launches every other leg.
//   GET  /api/v2/status    which legs of a launch are live.
//   GET  /api/v2/meta      a coin's metadata by id (immutable).
//   GET  /api/v2/quote-fee what a launch on these chains costs right now (no signing).
//   GET  /api/v2/prices    every chain's native coin in USD.
//   POST /api/v2/collect   the admin's collect on every chain of a coin, signed by the admin wallet; the service
//                          (a collector on every factory) sends it, and the factory pays the admin.
//
// Keys come from the environment only: EQUO_SIGNER_KEY (signs snapshots) and EQUO_LAUNCHER_KEY (sends the legs
// and collects). Nothing here holds user funds: the launch fee goes from the creator's wallet to the launcher
// address by the factory itself.
import { ethers } from "ethers";
import { createHash } from "node:crypto";
import { q } from "./_indexer/src/db.js";
import { loadChains } from "./_indexer/src/config.js";

const ADMIN = "0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b";
const CHAIN_SUPPLY = 1_000_000_000n * 10n ** 9n;
const CEILING = 1n << 156n;
const LAUNCH_GAS = 7_700_000n; // one leg wired to seven chains, measured on forks of every chain
const FEE_MARGIN = 1.25; // over the gas the service pays
const FEE_MIN_USD = 0.5, FEE_MAX_USD = 50;
const SNAPSHOT_LIFE = 40 * 60;
const CG_IDS = { ETH: "ethereum", BNB: "binancecoin", HYPE: "hyperliquid", MON: "monad" };
const coder = ethers.AbiCoder.defaultAbiCoder();
const lc = (a) => String(a || "").toLowerCase();

const FACTORY = new ethers.Interface([
  "function launch((bytes32 launchId,address creator,string name,string symbol,string metadataURI,uint16 feeBps,uint64 deadline,uint32 feeEid,uint256 launchFeeUsd18,(uint32 eid,bytes32 coin,bytes32 legSalt,bytes32 pair,uint256 slice,uint256 quoteUsd18)[] legs) s, bytes signature, uint256 pairIn) payable returns (address)",
  "function launched(bytes32) view returns (bool)",
  "function listings(address) view returns (address creator, address pair, bytes32 launchId, uint64 createdAt, uint16 feeBps, bytes32 poolId, uint256 slice, uint256 quoteUsd18)",
  "function collect(address token, uint16 bps, address recipient) returns (uint256 coins, uint256 pair)",
]);
const V1_FACTORY = new ethers.Interface(["function pairUsdPrice(address) view returns (uint256)"]);
const CREATOR = new ethers.Interface(["function initCodeHash() view returns (bytes32)"]);
const DOMAIN = { name: "Equo", version: "2" };
const TYPES = {
  Snapshot: [
    { name: "launchId", type: "bytes32" }, { name: "creator", type: "address" }, { name: "name", type: "string" },
    { name: "symbol", type: "string" }, { name: "metadataURI", type: "string" }, { name: "feeBps", type: "uint16" },
    { name: "deadline", type: "uint64" }, { name: "feeEid", type: "uint32" }, { name: "launchFeeUsd18", type: "uint256" },
    { name: "legs", type: "Leg[]" },
  ],
  Leg: [
    { name: "eid", type: "uint32" }, { name: "coin", type: "bytes32" }, { name: "legSalt", type: "bytes32" },
    { name: "pair", type: "bytes32" }, { name: "slice", type: "uint256" }, { name: "quoteUsd18", type: "uint256" },
  ],
};

class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

// ------------------------------------------------------------------ chains and providers

let CH = null;
function chains() {
  if (!CH) CH = loadChains().filter((c) => c.v2 && c.v2.factory);
  return CH;
}
const byKey = (k) => chains().find((c) => c.key === k);
const byEid = (e) => chains().find((c) => Number(c.lzEid) === Number(e));
const providers = new Map();
/** The chain's RPCs in order; `use` runs on each until one answers. */
async function withRpc(c, use) {
  if (!providers.has(c.key)) providers.set(c.key, c.rpcs.map((u) => new ethers.JsonRpcProvider(u, c.chainId, { staticNetwork: true, batchMaxCount: 1 })));
  let last;
  for (const p of providers.get(c.key)) {
    try { return await use(p); } catch (e) { last = e; if (e && (e.code === "CALL_EXCEPTION" || e.code === "INSUFFICIENT_FUNDS" || e.code === "NONCE_EXPIRED")) throw e; }
  }
  throw last;
}
const call = (c, to, iface, fn, args) => withRpc(c, async (p) => iface.decodeFunctionResult(fn, await p.call({ to, data: iface.encodeFunctionData(fn, args) })));

function keys() {
  const s = process.env.EQUO_SIGNER_KEY, l = process.env.EQUO_LAUNCHER_KEY;
  if (!s || !l) throw new HttpError(503, "the launch service is not configured");
  return { signer: new ethers.Wallet(s), launcher: new ethers.Wallet(l) };
}

// ------------------------------------------------------------------ prices and gas

let priceCache = { at: 0, usd: {} };
/** USD per whole native coin on every chain: CoinGecko, else the first Equo factory's price on that chain. */
async function nativeUsd() {
  if (Date.now() - priceCache.at < 60_000) return priceCache.usd;
  const usd = {};
  try {
    const ids = [...new Set(Object.values(CG_IDS))].join(",");
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?vs_currencies=usd&ids=${ids}`, { signal: AbortSignal.timeout(5000) });
    if (r.ok) { const j = await r.json(); for (const c of chains()) { const id = CG_IDS[c.native]; if (j[id] && j[id].usd > 0) usd[c.key] = j[id].usd; } }
  } catch { /* fall back below */ }
  await Promise.all(chains().filter((c) => !usd[c.key] && c.priceFrom).map(async (c) => {
    try { usd[c.key] = Number((await call(c, c.priceFrom, V1_FACTORY, "pairUsdPrice", [c.wrappedNative]))[0]) / 1e18; } catch { /* no price */ }
  }));
  priceCache = { at: Date.now(), usd };
  return usd;
}

/** The gas price a launch pays on chain c (HyperEVM's legs go in its big blocks). */
async function gasPrice(c) {
  return withRpc(c, async (p) => {
    if (c.chainId === 999) {
      try { return BigInt(await p.send("eth_bigBlockGasPrice", [])); } catch { /* fall through */ }
    }
    return BigInt(await p.send("eth_gasPrice", []));
  });
}

/** Send `data` to `to` on chain c from the launch service's account: gas estimated with a margin. */
function send(c, wallet, to, data) {
  return withRpc(c, async (p) => {
    const w = wallet.connect(p);
    const est = await w.estimateGas({ to, data });
    const gp = await gasPrice(c);
    // legacy pricing at the chain's gas price with room for a rise; HyperEVM's legs go in its big blocks
    return (await w.sendTransaction({ to, data, gasLimit: (est * 12n) / 10n, gasPrice: (gp * 13n) / 10n })).hash;
  });
}

/** The launch fee in USD for legs on `keys` with `home` paid by the creator: the service's gas on the others. */
async function launchFee(home, legKeys) {
  const usd = await nativeUsd();
  const others = legKeys.filter((k) => k !== home);
  if (!others.length) return { usd: 0, perChain: {} };
  const per = {};
  await Promise.all(others.map(async (k) => {
    const c = byKey(k), gp = await gasPrice(c);
    per[k] = (Number(gp * LAUNCH_GAS) / 1e18) * (usd[k] || 0);
  }));
  const raw = Object.values(per).reduce((a, b) => a + b, 0) * FEE_MARGIN;
  return { usd: Math.min(FEE_MAX_USD, Math.max(FEE_MIN_USD, Math.ceil(raw * 100) / 100)), perChain: per };
}

// ------------------------------------------------------------------ snapshot

let initHash = null;
async function coinInitHash() {
  if (!initHash) { const c = byKey("base") || chains()[0]; initHash = (await call(c, c.v2.coinCreator, CREATOR, "initCodeHash", []))[0]; }
  return initHash;
}

/** A leg salt that gives the coin an address below the ceiling and ending in e9 on that chain. */
function mineLeg(c, launchId, creator, hash, start) {
  for (let n = start; ; n++) {
    const legSalt = ethers.zeroPadValue(ethers.toBeHex(n), 32);
    const s = ethers.keccak256(coder.encode(["bytes32", "address", "bytes32"], [launchId, creator, legSalt]));
    const coin = ethers.getCreate2Address(c.v2.coinCreator, s, hash);
    const v = BigInt(coin);
    if (v < CEILING && (v & 0xffn) === 0xe9n) return { coin, legSalt };
  }
}

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const httpUrl = (v) => { v = str(v, 300); return /^https?:\/\/\S+$/i.test(v) ? v : ""; };

async function storeMeta(meta) {
  const body = {
    description: str(meta.description, 1000),
    image: typeof meta.image === "string" && /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(meta.image) && meta.image.length <= 400_000 ? meta.image : "",
    website: httpUrl(meta.website), x: httpUrl(meta.x), telegram: httpUrl(meta.telegram),
  };
  const json = JSON.stringify(body);
  const id = createHash("sha256").update(json).digest("hex").slice(0, 40);
  await q("insert into coin_meta (id, body) values ($1, $2) on conflict (id) do nothing", [id, json]);
  return id;
}

async function quote(body, origin) {
  const { signer } = keys();
  const creator = ethers.getAddress(String(body.creator || ""));
  const name = str(body.name, 64), symbol = str(body.symbol, 16).toUpperCase();
  if (!name || !symbol || !/^[A-Z0-9$._-]+$/.test(symbol)) throw new HttpError(400, "a name and a symbol (letters and digits) are needed");
  const feeBps = Number(body.feeBps);
  if (!Number.isInteger(feeBps) || feeBps < 100 || feeBps > 500) throw new HttpError(400, "the trading fee is 1% to 5%");
  const legKeys = [...new Set(Array.isArray(body.chains) ? body.chains : [])].filter((k) => byKey(k));
  const home = String(body.home || "");
  if (!legKeys.length || !legKeys.includes(home)) throw new HttpError(400, "choose the chains, including the one you launch from");
  const usd = await nativeUsd();
  for (const k of legKeys) if (!(usd[k] > 0)) throw new HttpError(503, `no price for ${byKey(k).name} right now, try again in a minute`);

  const metaId = await storeMeta(body.meta || {});
  const metadataURI = `${origin}/api/v2/meta?id=${metaId}`;
  const launchId = ethers.hexlify(ethers.randomBytes(32));
  const hash = await coinInitHash();
  const legs = legKeys.map((k) => byKey(k)).sort((a, b) => a.lzEid - b.lzEid).map((c) => {
    const m = mineLeg(c, launchId, creator, hash, 0);
    return { eid: c.lzEid, coin: ethers.zeroPadValue(m.coin, 32), legSalt: m.legSalt, pair: ethers.ZeroHash, slice: CHAIN_SUPPLY, quoteUsd18: ethers.parseEther(usd[c.key].toFixed(12)) };
  });
  const fee = await launchFee(home, legKeys);
  const homeC = byKey(home);
  const snap = {
    launchId, creator, name, symbol, metadataURI, feeBps,
    deadline: Math.floor(Date.now() / 1000) + SNAPSHOT_LIFE,
    feeEid: homeC.lzEid, launchFeeUsd18: ethers.parseEther(fee.usd.toFixed(2)), legs,
  };
  const signature = await signer.signTypedData(DOMAIN, TYPES, snap);
  const homeLeg = legs.find((l) => l.eid === homeC.lzEid);
  const feeWei = (snap.launchFeeUsd18 * 10n ** 18n + homeLeg.quoteUsd18 - 1n) / homeLeg.quoteUsd18;
  return {
    snapshot: jsonable(snap), signature, home, factory: homeC.v2.factory, chainId: homeC.chainId,
    launchFeeUsd: fee.usd, launchFeeWei: feeWei.toString(), nativeUsd: Object.fromEntries(legKeys.map((k) => [k, usd[k]])),
    coins: Object.fromEntries(legs.map((l) => [byEid(l.eid).key, ethers.getAddress("0x" + l.coin.slice(26))])),
  };
}

const jsonable = (o) => JSON.parse(JSON.stringify(o, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
function parseSnap(s) {
  if (!s || !Array.isArray(s.legs)) throw new HttpError(400, "snapshot missing");
  return {
    launchId: s.launchId, creator: ethers.getAddress(s.creator), name: String(s.name), symbol: String(s.symbol), metadataURI: String(s.metadataURI),
    feeBps: Number(s.feeBps), deadline: Number(s.deadline), feeEid: Number(s.feeEid), launchFeeUsd18: BigInt(s.launchFeeUsd18),
    legs: s.legs.map((l) => ({ eid: Number(l.eid), coin: l.coin, legSalt: l.legSalt, pair: l.pair, slice: BigInt(l.slice), quoteUsd18: BigInt(l.quoteUsd18) })),
  };
}

// ------------------------------------------------------------------ status and completion

async function status(snapOrId) {
  const legs = snapOrId.legs;
  const out = {};
  await Promise.all(legs.map(async (l) => {
    const c = byEid(l.eid);
    if (!c) { out[l.eid] = { error: "unknown chain" }; return; }
    try { out[c.key] = { launched: (await call(c, c.v2.factory, FACTORY, "launched", [snapOrId.launchId]))[0], coin: ethers.getAddress("0x" + l.coin.slice(26)) }; }
    catch (e) { out[c.key] = { error: e.shortMessage || e.message }; }
  }));
  return out;
}

async function complete(body) {
  const { signer, launcher } = keys();
  const snap = parseSnap(body.snapshot);
  if (ethers.verifyTypedData(DOMAIN, TYPES, snap, String(body.signature || "")) !== signer.address) throw new HttpError(400, "not a snapshot from this service");
  if (snap.deadline < Math.floor(Date.now() / 1000)) throw new HttpError(410, "this snapshot has expired");
  const home = byEid(snap.feeEid);
  const st = await status(snap);
  if (!home || !st[home.key] || !st[home.key].launched) throw new HttpError(409, "launch on your own chain first; the service launches the rest after it");
  // one completion per launch at a time; a retry after two minutes may send what is still missing
  const got = await q(
    `insert into launch_jobs (launch_id) values ($1) on conflict (launch_id) do update set started_at = now()
     where launch_jobs.started_at < now() - interval '2 minutes' returning launch_id`, [lc(snap.launchId)]);
  if (!got.rows.length) return { legs: st, sent: {}, busy: true };
  const sent = {};
  await Promise.all(snap.legs.map(async (l) => {
    const c = byEid(l.eid);
    if (!c || c === home || st[c.key].launched) return;
    try {
      sent[c.key] = await send(c, launcher, c.v2.factory, FACTORY.encodeFunctionData("launch", [snap, body.signature, 0n]));
    } catch (e) {
      sent[c.key] = { error: e.shortMessage || e.message };
    }
  }));
  await q("update launch_jobs set txs = $2 where launch_id = $1", [lc(snap.launchId), JSON.stringify(sent)]);
  return { legs: st, sent };
}

// ------------------------------------------------------------------ admin collect

async function collect(body) {
  const { launcher } = keys();
  const launchId = String(body.launchId || "").toLowerCase(), bps = Number(body.bps), ts = Number(body.ts);
  if (!/^0x[0-9a-f]{64}$/.test(launchId) || !Number.isInteger(bps) || bps < 1 || bps > 10_000) throw new HttpError(400, "bad request");
  if (Math.abs(Date.now() / 1000 - ts) > 600) throw new HttpError(400, "the signature is too old, sign again");
  const msg = collectMessage(launchId, bps, ts);
  if (ethers.verifyMessage(msg, String(body.signature || "")) !== ADMIN) throw new HttpError(403, "only the admin wallet may collect");
  const legs = (await q("select chain, token from tokens where launch_id = $1 and gen = 2", [launchId])).rows;
  if (!legs.length) throw new HttpError(404, "no indexed coin with that launch id yet");
  const sent = {};
  await Promise.all(legs.map(async (r) => {
    const c = byKey(r.chain);
    try {
      const li = await call(c, c.v2.factory, FACTORY, "listings", [r.token]);
      if (lc(li.launchId) !== launchId) throw new Error("not this launch");
      sent[r.chain] = await send(c, launcher, c.v2.factory, FACTORY.encodeFunctionData("collect", [r.token, bps, ADMIN]));
    } catch (e) { sent[r.chain] = { error: e.shortMessage || e.message }; }
  }));
  return { sent };
}
export const collectMessage = (launchId, bps, ts) => `Equo collect\nlaunch: ${launchId}\nshare: ${bps} bps\ntime: ${ts}`;

// ------------------------------------------------------------------ http

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body);
  let s = "";
  for await (const c of req) { s += c; if (s.length > 600_000) throw new HttpError(413, "too large"); }
  return JSON.parse(s || "{}");
}

export async function handleV2(req, res, path) {
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  const u = new URL(req.url, "http://x");
  const origin = `https://${req.headers["x-forwarded-host"] || req.headers.host}`;
  try {
    let out;
    if (path === "v2/meta" && req.method === "GET") {
      const r = await q("select body from coin_meta where id = $1", [String(u.searchParams.get("id") || "")]);
      if (!r.rows.length) throw new HttpError(404, "unknown metadata");
      res.setHeader("cache-control", "public, max-age=31536000, immutable");
      out = r.rows[0].body;
    } else if (path === "v2/quote-fee" && req.method === "GET") {
      const legKeys = String(u.searchParams.get("chains") || "").split(",").filter((k) => byKey(k));
      const home = String(u.searchParams.get("home") || "");
      out = { ...(await launchFee(home, legKeys)), nativeUsd: await nativeUsd() };
    } else if (path === "v2/prices" && req.method === "GET") {
      res.setHeader("cache-control", "public, max-age=30, s-maxage=30");
      out = { nativeUsd: await nativeUsd() };
    } else if (path === "v2/status" && req.method === "POST") {
      const b = await readBody(req);
      out = await status(parseSnap(b.snapshot));
    } else if (req.method === "POST" && path === "v2/quote") out = await quote(await readBody(req), origin);
    else if (req.method === "POST" && path === "v2/complete") out = await complete(await readBody(req));
    else if (req.method === "POST" && path === "v2/collect") out = await collect(await readBody(req));
    else throw new HttpError(404, "not found");
    res.statusCode = 200;
    res.end(JSON.stringify(out));
  } catch (e) {
    const code = e instanceof HttpError ? e.code : 500;
    if (code === 500) console.error(path, e);
    res.statusCode = code;
    res.end(JSON.stringify({ error: code === 500 ? "internal error: " + (e.shortMessage || e.message) : e.message }));
  }
}
