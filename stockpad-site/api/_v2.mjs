// The Equo v2 launch service, behind /api/v2/* (api/index.mjs routes here before the indexer).
//
//   POST /api/v2/quote     a signed snapshot for a new coin: its metadata stored under a content id, one leg per
//                          chosen chain (each leg's salt mined so the coin's address ends in e9), every chain's
//                          native price, and the launch fee that pays the service's gas on the other chains.
//   POST /api/v2/complete  after the creator's own leg is mined: the service launches every other leg. A Solana leg
//                          (post, launch, then its LayerZero OFT setup) takes several calls: each runs what it can
//                          in ~45 seconds and records the steps done; call again until status says it is live.
//   GET  /api/v2/status    which legs of a launch are live.
//   GET  /api/v2/meta      a coin's metadata by id (immutable).
//   GET  /api/v2/quote-fee what a launch on these chains costs right now (no signing).
//   GET  /api/v2/prices    every chain's native coin in USD.
//   POST /api/v2/collect   the admin's collect on every chain of a coin, signed by the admin wallet; the service
//                          (a collector on every factory) sends it, and the factory pays the admin.
//
// Keys come from the environment only: EQUO_SIGNER_KEY (signs snapshots), EQUO_LAUNCHER_KEY (sends the EVM legs
// and collects) and EQUO_SOL_LAUNCHER_KEY (a Solana keypair as a JSON byte array: sends the Solana leg). Nothing here holds user funds: the launch fee goes from the creator's wallet to the launcher
// address by the factory itself.
import { ethers } from "ethers";
import { createHash } from "node:crypto";
import { q } from "./_indexer/src/db.js";
import { loadChains } from "./_indexer/src/config.js";

const ADMIN = "0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b";
const CHAIN_SUPPLY = 1_000_000_000n * 10n ** 9n;
const CEILING = 1n << 156n;
const LAUNCH_GAS = 8_200_000n; // one leg wired to eight chains (Solana included), measured on forks of every chain
const FEE_MARGIN = 1.25; // over the gas the service pays
const FEE_MIN_USD = 0.5, FEE_MAX_USD = 50;
const SNAPSHOT_LIFE = 40 * 60;
const CG_IDS = { ETH: "ethereum", BNB: "binancecoin", HYPE: "hyperliquid", MON: "monad", SOL: "solana" };
/// Solana as a leg: LayerZero's eid, and what its leg costs the service in SOL (rent, measured on a local validator
/// with LayerZero's programs: the coin and pool, the OFT store, then each EVM peer's endpoint, ULN and peer accounts).
const SOL = { key: "sol", name: "Solana", native: "SOL", lzEid: 30168, rpc: process.env.EQUO_SOL_RPC || "https://api.mainnet-beta.solana.com" };
const SOL_LEG_BASE = 0.05, SOL_LEG_PER_PEER = 0.048;
const SOL_BUDGET_MS = 45_000;
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
const byKey = (k) => (k === SOL.key ? SOL : chains().find((c) => c.key === k));
const byEid = (e) => (Number(e) === SOL.lzEid ? SOL : chains().find((c) => Number(c.lzEid) === Number(e)));
const isSol = (c) => c === SOL;
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
    if (r.ok) { const j = await r.json(); for (const c of [...chains(), SOL]) { const id = CG_IDS[c.native]; if (j[id] && j[id].usd > 0) usd[c.key] = j[id].usd; } }
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
    const c = byKey(k);
    if (isSol(c)) { per[k] = (SOL_LEG_BASE + SOL_LEG_PER_PEER * (legKeys.length - 1)) * (usd[k] || 0); return; }
    const gp = await gasPrice(c);
    per[k] = (Number(gp * LAUNCH_GAS) / 1e18) * (usd[k] || 0);
  }));
  const raw = Object.values(per).reduce((a, b) => a + b, 0) * FEE_MARGIN;
  return { usd: Math.min(FEE_MAX_USD, Math.max(FEE_MIN_USD, Math.ceil(raw * 100) / 100)), perChain: per };
}

// ------------------------------------------------------------------ Solana

// The Solana leg's code and its SDKs load on first use only (they are large).
let SOLMOD = null;
async function solana() {
  if (!SOLMOD) {
    const [web3, leg, setup] = await Promise.all([import("@solana/web3.js"), import("./_sol/leg.mjs"), import("./_sol/oft-setup.mjs")]);
    SOLMOD = { web3, leg, setup };
  }
  return SOLMOD;
}
function solLauncher() {
  const k = process.env.EQUO_SOL_LAUNCHER_KEY;
  if (!k || !SOLMOD) throw new HttpError(503, "the Solana launcher is not configured");
  return SOLMOD.web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(k)));
}
/** The leg keypairs for a launch (escrow, mint, position NFT), from the Solana launcher's secret. */
const solKeys = (launchId) => SOLMOD.leg.legKeys(createHash("sha256").update("equo-sol-legs:" + process.env.EQUO_SOL_LAUNCHER_KEY).digest(), launchId);

/** Where a launch's Solana leg stands: its steps done (recorded) out of all. */
async function solStatus(snap) {
  await solana();
  const r = await q("select sol_done from launch_jobs where launch_id = $1", [lc(snap.launchId)]);
  const done = r.rows.length ? r.rows[0].sol_done : [];
  const total = 2 + 1 + 4 * (snap.legs.length - 1) + 2;
  const k = solKeys(snap.launchId);
  return { launched: done.length >= total, steps: done.length, of: total, coin: k.mint.publicKey.toBase58(), store: k.store.toBase58() };
}

/** Runs what is left of the Solana leg for up to SOL_BUDGET_MS, recording each step. */
async function solRun(snap, signature) {
  const { web3, leg, setup } = await solana();
  const launcher = solLauncher();
  const cx = new web3.Connection(SOL.rpc, "confirmed");
  const { umi, signer } = setup.umiFor(SOL.rpc, launcher);
  const p = leg.legPlan({ cx, ethers, launcher, umi, signer, snap, sig: signature, keys: solKeys(snap.launchId), feeTo: launcher.publicKey });
  const r = await q("select sol_done from launch_jobs where launch_id = $1", [lc(snap.launchId)]);
  const done = new Set(r.rows.length ? r.rows[0].sol_done : []);
  try {
    await leg.runLeg(umi, p, done, {
      deadline: Date.now() + SOL_BUDGET_MS,
      onDone: async () => { await q("update launch_jobs set sol_done = $2 where launch_id = $1", [lc(snap.launchId), JSON.stringify([...done])]); },
    });
  } catch (e) {
    return { steps: done.size, of: leg.legStepIds(p).length, error: e.shortMessage || e.message };
  }
  if (done.size >= leg.legStepIds(p).length) await solRecord(snap, p);
  return { steps: done.size, of: leg.legStepIds(p).length };
}

/** The coin's id across chains, as the indexer computes it: its Ethereum address, else the smallest chain:address. */
function coinIdOf(snap) {
  const members = snap.legs.filter((l) => l.eid !== SOL.lzEid).map((l) => `${byEid(l.eid).key}:${lc("0x" + l.coin.slice(26))}`);
  return members.find((m) => m.startsWith("eth:")) || members.sort()[0];
}

/** A live Solana leg goes into the indexer's tokens, so the coin's chains include it. */
async function solRecord(snap, p) {
  const { leg } = await solana();
  const sol = snap.legs.find((l) => l.eid === SOL.lzEid);
  const creator = new (await solana()).web3.PublicKey(Buffer.from(sol.legSalt.slice(2), "hex")).toBase58();
  const mint = p.mint.toBase58(), pool = leg.poolOf(p.mint, new (await solana()).web3.PublicKey(leg.WSOL)).toBase58();
  await q(
    `insert into tokens (chain, token, coin_id, creator, pair, pool_id, name, symbol, launch_block, launch_ts, launch_tx, launch_pair_usd, gen, fee_bps, launch_id, metadata_uri)
     values ('sol', $1, $2, $3, $4, $5, $6, $7, 0, $8, '', $9, 2, $10, $11, $12) on conflict (chain, token) do nothing`,
    [mint, coinIdOf(snap), creator, leg.WSOL, pool, snap.name, snap.symbol, Math.floor(Date.now() / 1000), sol.quoteUsd18.toString(), snap.feeBps, lc(snap.launchId), snap.metadataURI]);
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
  const image = typeof meta.image === "string" ? meta.image : "";
  if (image && !/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(image)) throw new HttpError(400, "the logo must be a png, jpeg, webp or gif image");
  if (image.length > 400_000) throw new HttpError(400, "the logo is too large, 300 KB max");
  const body = {
    description: str(meta.description, 1000),
    image,
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
  if (home === SOL.key) throw new HttpError(400, "launch from an EVM chain; Solana is launched by Equo");
  let solWallet = null;
  if (legKeys.includes(SOL.key)) {
    const { web3 } = await solana();
    try { solWallet = new web3.PublicKey(String(body.solWallet || "")); } catch { throw new HttpError(400, "a Solana wallet is needed for the creator's fees on Solana"); }
  }
  const usd = await nativeUsd();
  for (const k of legKeys) if (!(usd[k] > 0)) throw new HttpError(503, `no price for ${byKey(k).name} right now, try again in a minute`);

  const metaId = await storeMeta(body.meta || {});
  const metadataURI = `${origin}/api/v2/meta?id=${metaId}`;
  const launchId = ethers.hexlify(ethers.randomBytes(32));
  const hash = await coinInitHash();
  const legs = legKeys.map((k) => byKey(k)).sort((a, b) => a.lzEid - b.lzEid).map((c) => {
    if (isSol(c)) {
      // the leg's coin is the OFT store of an escrow derived from the service secret and the launch id
      const k = solKeys(launchId);
      return { eid: c.lzEid, coin: "0x" + k.store.toBuffer().toString("hex"), legSalt: "0x" + solWallet.toBuffer().toString("hex"), pair: ethers.ZeroHash, slice: CHAIN_SUPPLY, quoteUsd18: ethers.parseEther(usd[c.key].toFixed(12)) };
    }
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
    coins: Object.fromEntries(legs.map((l) => [byEid(l.eid).key, l.eid === SOL.lzEid ? solKeys(launchId).mint.publicKey.toBase58() : ethers.getAddress("0x" + l.coin.slice(26))])),
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
    if (isSol(c)) { try { out[c.key] = await solStatus(snapOrId); } catch (e) { out[c.key] = { error: e.message }; } return; }
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
  // one completion per launch at a time (a call holds the job for up to two minutes)
  const got = await q(
    `insert into launch_jobs (launch_id) values ($1) on conflict (launch_id) do update set started_at = now()
     where launch_jobs.started_at < now() - interval '2 minutes' returning launch_id, evm_at`, [lc(snap.launchId)]);
  if (!got.rows.length) return { legs: st, sent: {}, busy: true };
  const sent = {};
  try {
    // the EVM legs: sent once, and again only for what is still missing two minutes later
    const evmAt = got.rows[0].evm_at;
    const missing = snap.legs.map((l) => byEid(l.eid)).filter((c) => c && c !== home && !isSol(c) && !st[c.key].launched);
    if (missing.length && (!evmAt || Date.now() - new Date(evmAt).getTime() > 120_000)) {
      await Promise.all(missing.map(async (c) => {
        try {
          sent[c.key] = await send(c, launcher, c.v2.factory, FACTORY.encodeFunctionData("launch", [snap, body.signature, 0n]));
        } catch (e) {
          sent[c.key] = { error: e.shortMessage || e.message };
        }
      }));
      await q("update launch_jobs set txs = $2, evm_at = now() where launch_id = $1", [lc(snap.launchId), JSON.stringify(sent)]);
    }
    // the Solana leg: as many of its steps as fit in this call
    if (snap.legs.some((l) => l.eid === SOL.lzEid) && !(st[SOL.key] && st[SOL.key].launched)) sent[SOL.key] = await solRun(snap, body.signature);
  } finally {
    await q("update launch_jobs set started_at = now() - interval '3 minutes' where launch_id = $1", [lc(snap.launchId)]);
  }
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

/** For scripts and tests: the service's steps without the HTTP layer. */
export const _internal = { quote, complete, status, solRun, solStatus };
