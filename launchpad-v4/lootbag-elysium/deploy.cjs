// Deploys Lootbag on Elysium (chain 99901, gas in HYPE): the route swapper, the payout contract, the hook at a CREATE2
// address carrying its permission flags, the factory, the Bags, the airdrop pot and the HYPE trade router (which has
// no owner). Wires them, lists KNTQ and WHYPE both as quotes a coin can be paired with (each at an opening tick worked
// out from live prices) and as rewards holders can be paid in, sets the KNTQ <-> WHYPE routes through Elysium's
// WHYPE/KNTQ Uniswap v4 pool, makes the keeper wallet a keeper, and offers ownership of all six owned contracts to the
// owner wallet. The factory stays paused until the owner opens launches. There are no stock tokens here.
//
// What differs from the Base deployment: KNTQ stands where VVV stood (the Bag mint price, the Bag pot and the airdrop
// pot), WHYPE is the hub and the wrapped native coin, the launch fee, copy fee and Bag mint price are set here in
// HYPE and KNTQ and fixed in the contracts, and a coin's launch block is Elysium's own block number (ArbSys).
//
//   forge build --skip test
//   node deploy.cjs                  dry run: prices, opening ticks, the plan and a gas estimate; sends nothing
//   KEYFILE=../../contracts/.env.deployer.kinex node deploy.cjs --send
//
// Elysium is an Arbitrum Orbit chain on HyperEVM. Its public RPC refuses large transactions ("parent gas estimate
// exceeds cap"); those are posted to the rollup's Inbox on HyperEVM instead, paid in HYPE from the same address on
// HyperEVM, so the deployer needs a little HYPE on both chains. Every transaction is signed and saved before it is
// sent, and steps done are kept in deployments/lootbag-elysium.progress.json, so a run that stops can be run again.
//
// Optional env: ELYSIUM_RPC, HYPEREVM_RPC, LOOTBAG_OWNER, LOOTBAG_TREASURY, LOOTBAG_KEEPER, HYPE_USD (else read from
// Hyperliquid), START_MCAP_USD (5000), MIN_DEV_BUY_USD (8.5), LAUNCH_FEE (0.025 HYPE), COPY_FEE (1.25 HYPE),
// BAG_MINT_KNTQ (400), ALLOW_CHAIN=1 (a local fork that reports another chain id; nothing is posted to HyperEVM).
const fs = require('fs'), path = require('path');
const { ethers } = require(fs.existsSync(path.join(__dirname, 'node_modules/ethers')) ? 'ethers' : path.join(__dirname, '../node_modules/ethers'));

const RPC = process.env.ELYSIUM_RPC || 'https://rpc.elysium.kinetiq.xyz';
const PARENT = { rpc: process.env.HYPEREVM_RPC || 'https://rpc.hyperliquid.xyz/evm', chainId: 999, inbox: '0xce59f8b65ad41c9dae4c07a0571a39824bd92cff' };
// the Kinex admin wallet, which owns this repo's other Elysium deployment
const OWNER = ethers.getAddress(process.env.LOOTBAG_OWNER || '0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b');
const TREASURY = ethers.getAddress(process.env.LOOTBAG_TREASURY || OWNER);
const KEEPER = ethers.getAddress(process.env.LOOTBAG_KEEPER || OWNER);
const START_MCAP_USD = Number(process.env.START_MCAP_USD || 5000);
const MIN_DEV_BUY_USD = Number(process.env.MIN_DEV_BUY_USD || 8.5);
const LAUNCH_FEE = ethers.parseEther(process.env.LAUNCH_FEE || '0.025'); // HYPE, fixed in the factory
const COPY_FEE = ethers.parseEther(process.env.COPY_FEE || '1.25'); // HYPE, fixed in the factory
const BAG_MINT_KNTQ = ethers.parseEther(process.env.BAG_MINT_KNTQ || '400'); // KNTQ, fixed in the Bags
const SEND = process.argv.includes('--send');

const A = {
  pm: '0xE2e105d3F7209A9DA11f83cCf3E7398a753823F1',
  create2: '0x4e59b44847b379578588920cA78FbF26c0B4956C',
  multicall: '0xcA11bde05977b3631167028862bE2a173976CA11',
  kntq: '0xe45a355d9e9cAd2aD85F2d03E3eE3102A036acF0',
  whype: '0xbA876237B0F021A6c6D852d6c26E107997cC5E81',
};
// Elysium's WHYPE/KNTQ Uniswap v4 pool that holds most of KNTQ's liquidity: dynamic fee, tick spacing 50, its own hook
const KNTQ_POOL = { currency0: A.whype, currency1: A.kntq, fee: 0x800000, tickSpacing: 50, hooks: '0xd47020285b80Bb3f4a4BcbDf4f4D2891ba24BDe3' };
// beforeInitialize | beforeAddLiquidity | beforeRemoveLiquidity | beforeSwap | afterSwap | both swap return deltas
const HOOK_FLAGS = 0x2accn, FLAG_MASK = 0x3fffn;
const TICK_SPACING = 200, SUPPLY_WHOLE = 1e9;
// the Bag pot's day list at deploy; $LOOT joins it once it has launched (bags.setDays)
const BAG_DAYS = ['KNTQ', 'WHYPE'];
// gas measured on a fork of Elysium, used only when the RPC will not estimate ("Live reader is not ready")
const MEASURED = { LootbagSwapper: 1_628_221n, LootbagPayout: 1_123_822n, LootbagHook: 1_428_765n, LootbagFactory: 4_674_201n, LootbagBags: 2_259_932n, LootbagAirdrop: 964_848n, LootbagRouter: 1_036_271n, call: 230_000n };

const AC = ethers.AbiCoder.defaultAbiCoder();
const eq = (a, b) => a.toLowerCase() === b.toLowerCase();
const art = (n) => {
  const f = path.join(__dirname, 'out', n + '.sol', n + '.json');
  if (!fs.existsSync(f)) throw new Error(`no build output for ${n}: run "forge build --skip test" in ${__dirname} first`);
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  return { abi: j.abi, bytecode: j.bytecode.object, iface: new ethers.Interface(j.abi) };
};
const DEP = path.join(__dirname, 'deployments');
const PROG = path.join(DEP, 'lootbag-elysium.progress.json'), OUT = path.join(DEP, 'lootbag-elysium.json');

// The public Elysium RPC rate-limits and at times is "not ready"; such a request is tried again. A resent raw
// transaction the node already has resolves to its own hash, so a send that was cut off is safe to repeat.
const RATE = /rate.?limit|429|too many|-32005|not ready|timeout|ECONNRESET|socket hang up|50[234]|missing response/i;
class RetryProvider extends ethers.JsonRpcProvider {
  async send(method, params) {
    for (let i = 0; ; i++) {
      try { return await super.send(method, params); } catch (e) {
        const msg = (e.shortMessage || '') + ' ' + (e.message || '') + ' ' + JSON.stringify(e.error || e.info || '');
        if (method === 'eth_sendRawTransaction' && i > 0 && /already known|nonce too low|known transaction/i.test(msg)) return ethers.keccak256(params[0]);
        if (i >= 8 || !RATE.test(msg)) throw e;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** Math.min(i, 4)));
      }
    }
  }
}

(async () => {
  const P = new RetryProvider(RPC, undefined, { staticNetwork: true, cacheTimeout: -1, batchMaxCount: 1 });
  const chainId = Number((await P.getNetwork()).chainId), fork = chainId !== 99901;
  if (fork && !process.env.ALLOW_CHAIN) throw new Error(`chain ${chainId} is not Elysium (99901); set ALLOW_CHAIN=1 for a fork that reports another id`);
  for (const [n, a] of [['PoolManager', A.pm], ['CREATE2 deployer', A.create2], ['KNTQ', A.kntq], ['WHYPE', A.whype], ['the WHYPE/KNTQ pool hook', KNTQ_POOL.hooks]]) {
    if ((await P.getCode(a)) === '0x') throw new Error(`${n} ${a} has no code on this chain`);
  }

  let w = null, me = OWNER;
  const keyFile = process.env.KEYFILE || path.join(__dirname, '../../contracts/.env.deployer.kinex');
  if (SEND || fs.existsSync(keyFile)) {
    const m = fs.existsSync(keyFile) && fs.readFileSync(keyFile, 'utf8').match(/PRIVATE_KEY=(0x)?([0-9a-fA-F]{64})/);
    if (!m) throw new Error('no PRIVATE_KEY=... in ' + keyFile);
    w = new ethers.Wallet('0x' + m[2]);
    me = w.address;
  }
  console.log(`${SEND ? '' : 'DRY RUN (nothing is sent). '}deployer ${me}, ${ethers.formatEther(await P.getBalance(me))} HYPE on ${fork ? 'the fork' : 'Elysium'}`);
  console.log(`owner ${OWNER}  treasury ${TREASURY}  keeper ${KEEPER}`);

  // ---------------------------------------------------------------- live prices -> quotes
  // HYPE in dollars from Hyperliquid's mid price (or HYPE_USD); KNTQ per HYPE from the pool the routes use
  let hypeUsd = Number(process.env.HYPE_USD || 0), kntqSpotUsd = 0;
  try {
    const r = await fetch('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'allMids' }), signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    if (!hypeUsd && j && j.HYPE) hypeUsd = Number(j.HYPE);
    if (j && j['@334']) kntqSpotUsd = Number(j['@334']); // KNTQ's spot market on Hyperliquid
  } catch (e) { /* no price feed from here */ }
  if (!(hypeUsd > 1 && hypeUsd < 1e4)) throw new Error('no HYPE price: Hyperliquid could not be read, so set HYPE_USD');
  const pm = new ethers.Contract(A.pm, ['function extsload(bytes32) view returns (bytes32)'], P);
  const poolId = ethers.keccak256(AC.encode(['address', 'address', 'uint24', 'int24', 'address'], [KNTQ_POOL.currency0, KNTQ_POOL.currency1, KNTQ_POOL.fee, KNTQ_POOL.tickSpacing, KNTQ_POOL.hooks]));
  const stateSlot = ethers.keccak256(AC.encode(['bytes32', 'uint256'], [poolId, 6]));
  const slot0 = BigInt(await pm.extsload(stateSlot)), liquidity = BigInt(await pm.extsload(ethers.toBeHex(BigInt(stateSlot) + 3n, 32))) & ((1n << 128n) - 1n);
  const sqrtP = slot0 & ((1n << 160n) - 1n);
  if (sqrtP === 0n || liquidity === 0n) throw new Error('the WHYPE/KNTQ pool is not there or is empty; the routes would not work');
  const kntqPerHype = (Number(sqrtP) / 2 ** 96) ** 2; // KNTQ (currency1) per WHYPE (currency0), both 18 decimals
  const kntqUsd = hypeUsd / kntqPerHype, poolWhype = Number(liquidity) / (Number(sqrtP) / 2 ** 96) / 1e18;
  console.log(`prices: HYPE $${hypeUsd.toFixed(2)}  KNTQ $${kntqUsd.toFixed(4)} (${kntqPerHype.toFixed(1)} KNTQ to the HYPE in the pool; the pool trades against about ${Math.round(poolWhype)} WHYPE in range)`);
  if (kntqSpotUsd && Math.abs(kntqUsd / kntqSpotUsd - 1) > 0.1) throw new Error(`the pool prices KNTQ at $${kntqUsd.toFixed(4)} but Hyperliquid at $${kntqSpotUsd}: more than 10% apart, stopping`);
  if (!(kntqPerHype > 1 && kntqPerHype < 1e6)) throw new Error('the pool price looks wrong; stopping');

  // the opening tick as the factory wants it: the tick when the coin is currency0 (coin priced in the quote)
  const sig2 = (v) => { const s = v.toString(), z = BigInt(Math.max(0, s.length - 2)); return (v / 10n ** z) * 10n ** z; };
  const quoteCfg = (sym, token, usd) => {
    const mcapBase = (START_MCAP_USD / usd) * 1e18;
    const tick = Math.round(Math.log(mcapBase / (SUPPLY_WHOLE * 1e18)) / Math.log(1.0001) / TICK_SPACING) * TICK_SPACING;
    const minDevBuy = sig2(BigInt(Math.round((MIN_DEV_BUY_USD / usd) * 1e18)));
    const opensAt = 1.0001 ** tick * SUPPLY_WHOLE;
    return { sym, token, tick, minDevBuy, opensAt, opensAtUsd: opensAt * usd };
  };
  const prog = SEND && fs.existsSync(PROG) ? JSON.parse(fs.readFileSync(PROG, 'utf8')) : { deployer: me, steps: {} };
  if (prog.deployer !== me) throw new Error('the progress file belongs to another deployer: ' + PROG);
  const save = () => { fs.mkdirSync(DEP, { recursive: true }); fs.writeFileSync(PROG, JSON.stringify(prog, null, 1)); };
  // quotes are worked out once and kept, so a run that is continued later sets the same ticks as it started with
  const quotes = prog.quotes ? prog.quotes.map((q) => ({ ...q, minDevBuy: BigInt(q.minDevBuy) })) : [quoteCfg('KNTQ', A.kntq, kntqUsd), quoteCfg('WHYPE', A.whype, hypeUsd)];
  for (const q of quotes) console.log(`quote ${q.sym.padEnd(5)} opens at tick ${q.tick}: 1B coins worth ${q.opensAt.toFixed(q.sym === 'KNTQ' ? 0 : 2)} ${q.sym} (~$${Math.round(q.opensAtUsd)}), min dev buy ${ethers.formatEther(q.minDevBuy)} ${q.sym}`);
  console.log(`fees, fixed in the contracts: launch ${ethers.formatEther(LAUNCH_FEE)} HYPE (~$${(Number(ethers.formatEther(LAUNCH_FEE)) * hypeUsd).toFixed(2)}), copied ticker ${ethers.formatEther(COPY_FEE)} HYPE more (~$${(Number(ethers.formatEther(COPY_FEE)) * hypeUsd).toFixed(0)}), Bag mint ${ethers.formatEther(BAG_MINT_KNTQ)} KNTQ (~$${(Number(ethers.formatEther(BAG_MINT_KNTQ)) * kntqUsd).toFixed(0)}) and 100,000 $LOOT burned`);
  const bySym = { KNTQ: A.kntq, WHYPE: A.whype };
  const days = BAG_DAYS.map((s) => bySym[s]);
  const rewards = [['KNTQ', A.kntq], ['WHYPE', A.whype]];
  const v4 = { kind: 1, pool: ethers.ZeroAddress, key: [KNTQ_POOL.currency0, KNTQ_POOL.currency1, KNTQ_POOL.fee, KNTQ_POOL.tickSpacing, KNTQ_POOL.hooks] };
  const routes = [{ name: 'route KNTQ>WHYPE', tokenIn: A.kntq, tokenOut: A.whype, hops: [v4] }, { name: 'route WHYPE>KNTQ', tokenIn: A.whype, tokenOut: A.kntq, hops: [v4] }];
  console.log(`plan: 7 contracts, ${quotes.length} quotes, ${rewards.length} rewards, ${routes.length} routes${eq(me, OWNER) ? '' : ', 6 ownership offers'}`);

  // ---------------------------------------------------------------- contracts
  const Swapper = art('LootbagSwapper'), Payout = art('LootbagPayout'), Hook = art('LootbagHook'), Factory = art('LootbagFactory'), Bags = art('LootbagBags'), Airdrop = art('LootbagAirdrop'), Router = art('LootbagRouter');
  const init = (a, types, args) => a.bytecode + AC.encode(types, args).slice(2);
  const hookInit = init(Hook, ['address', 'address'], [A.pm, me]);
  if (!prog.hookSalt) {
    const h = ethers.keccak256(hookInit);
    for (let i = 0n; ; i++) {
      const s = ethers.zeroPadValue(ethers.toBeHex(i), 32), a = ethers.getCreate2Address(A.create2, s, h);
      if ((BigInt(a) & FLAG_MASK) === HOOK_FLAGS && (await P.getCode(a)) === '0x') { prog.hookSalt = s; prog.hook = a; break; }
    }
    if (SEND) save();
  }
  console.log('hook will be', prog.hook);
  const fee = await P.getFeeData(), gasPrice = fee.gasPrice ?? fee.maxFeePerGas;

  if (!SEND) {
    let gas = 0n, big = 0;
    for (const [n, data, to] of [
      ['LootbagSwapper', init(Swapper, ['address', 'address', 'address'], [A.pm, me, A.whype])],
      ['LootbagPayout', init(Payout, ['address'], [me])],
      ['LootbagHook', prog.hookSalt + hookInit.slice(2), A.create2],
      ['LootbagAirdrop', init(Airdrop, ['address', 'address', 'address'], [A.kntq, A.multicall, me])],
    ]) {
      const est = await P.estimateGas({ from: me, to, data }).catch(() => MEASURED[n]);
      gas += est;
      if (data.length / 2 > 6000) big++;
      console.log(`  ${n.padEnd(18)} ~${est} gas, ${Math.round(data.length / 2)} bytes`);
    }
    // measured on a fork of Elysium: the whole run (24 transactions, 14.5M gas) is about 2.8 times these four
    console.log(`dry run: these four are ~${gas} gas; the full run is roughly ${(gas * 28n) / 10n} gas, about ${ethers.formatEther(((gas * 28n) / 10n) * gasPrice)} HYPE at the current ${ethers.formatUnits(gasPrice, 'gwei')} gwei.`);
    console.log(`The contract creations are too large for Elysium's public RPC (${big} of these four are over 6,000 bytes), so they are posted to the Inbox on HyperEVM: the deployer also needs HYPE on HyperEVM for that. Add --send to deploy.`);
    return;
  }

  // ---------------------------------------------------------------- sending
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const receiptOf = async (hash) => { try { return await P.send('eth_getTransactionReceipt', [hash]); } catch { return null; } };
  const PARENT_POST_BYTES = Number(process.env.PARENT_POST_BYTES || 6000);
  let parentW = null;
  // posting a signed Elysium transaction straight to its HyperEVM inbox: message kind 4 (signed L2 tx) + raw bytes
  async function postToInbox(raw) {
    if (!parentW) parentW = new ethers.Wallet(w.privateKey, new RetryProvider(PARENT.rpc, PARENT.chainId, { staticNetwork: true, cacheTimeout: -1, batchMaxCount: 1 }));
    const data = new ethers.Interface(['function sendL2Message(bytes messageData) returns (uint256)']).encodeFunctionData('sendL2Message', ['0x04' + raw.slice(2)]);
    const gas = await parentW.estimateGas({ to: PARENT.inbox, data });
    const t = await parentW.sendTransaction({ to: PARENT.inbox, data, gasLimit: (gas * 13n) / 10n });
    const r = await t.wait();
    if (r.status !== 1) throw new Error('inbox post reverted ' + t.hash);
    return t.hash;
  }
  const maxFeePerGas = (fee.maxFeePerGas ?? fee.gasPrice) * 2n, maxPriorityFeePerGas = fee.maxPriorityFeePerGas ?? 0n;
  async function step(name, req) {
    let rec = prog.steps[name];
    if (rec && rec.done) return rec;
    if (!rec) {
      // a revert shows here, before anything is signed; only an RPC that will not estimate falls back to the measured gas
      const est = await P.estimateGas({ from: me, ...req }).catch((e) => {
        const m = (e.shortMessage || '') + ' ' + (e.message || '');
        if (RATE.test(m)) return MEASURED[name] || MEASURED.call;
        throw new Error(name + ': ' + (e.shortMessage || e.message));
      });
      const used = Object.values(prog.steps).map((s) => s.nonce);
      const nonce = Math.max(await P.getTransactionCount(me, 'latest'), used.length ? Math.max(...used) + 1 : 0);
      const raw = await w.signTransaction({ type: 2, chainId, nonce, gasLimit: (est * 13n) / 10n + 200_000n, maxFeePerGas, maxPriorityFeePerGas, to: req.to ?? null, data: req.data, value: 0n });
      rec = prog.steps[name] = { nonce, hash: ethers.keccak256(raw), raw, address: req.to ? null : ethers.getCreateAddress({ from: me, nonce }) };
      save();
    }
    for (let round = 0; round < 40; round++) {
      let r = await receiptOf(rec.hash);
      if (!r) {
        let viaParent = !fork && rec.raw.length > 2 * PARENT_POST_BYTES;
        if (!viaParent) {
          try { await P.send('eth_sendRawTransaction', [rec.raw]); } catch (e) {
            const m = (e.shortMessage || '') + ' ' + JSON.stringify(e.error || e.info || '');
            if (!fork && /exceeds cap/i.test(m)) viaParent = true;
            else if (!/already known|known transaction|nonce too low/i.test(m)) console.log(`  ${name}: send not confirmed (${m.replace(/\s+/g, ' ').slice(0, 120)}), checking`);
          }
        }
        if (viaParent && (!rec.parentHash || round - (rec.parentRound ?? 0) >= 5)) { rec.parentHash = await postToInbox(rec.raw); rec.parentRound = round; save(); console.log(`  ${name}: posted to the HyperEVM inbox in ${rec.parentHash}`); }
        for (let i = 0; i < 20 && !r; i++) { await sleep(fork ? 200 : 3000); r = await receiptOf(rec.hash); }
      }
      if (r) {
        if (Number(r.status) !== 1) throw new Error(`${name} reverted in ${rec.hash}`);
        rec.done = true; rec.block = Number(r.blockNumber); rec.gas = Number(r.gasUsed); delete rec.raw;
        if (r.contractAddress) rec.address = ethers.getAddress(r.contractAddress);
        save();
        console.log(`  ${name.padEnd(26)} ${rec.address || 'ok'}  ${rec.gas} gas`);
        return rec;
      }
    }
    throw new Error(`${name}: no receipt for ${rec.hash} after many tries; run again to keep re-sending it`);
  }
  const call = (name, to, a, fn, args) => step(name, { to, data: a.iface.encodeFunctionData(fn, args) });
  prog.quotes = prog.quotes || quotes.map((q) => ({ ...q, minDevBuy: q.minDevBuy.toString() }));
  save();

  const swapper = (await step('LootbagSwapper', { data: init(Swapper, ['address', 'address', 'address'], [A.pm, me, A.whype]) })).address;
  const payout = (await step('LootbagPayout', { data: init(Payout, ['address'], [me]) })).address;
  await step('LootbagHook', { to: A.create2, data: prog.hookSalt + hookInit.slice(2) });
  const hook = prog.hook;
  if ((await P.getCode(hook)) === '0x') throw new Error('the hook did not land at ' + hook);
  const factory = (await step('LootbagFactory', { data: init(Factory, ['address', 'address', 'address', 'address', 'address', 'address', 'address', 'uint256', 'uint256'], [A.pm, hook, payout, me, TREASURY, swapper, A.whype, LAUNCH_FEE, COPY_FEE]) })).address;
  const bags = (await step('LootbagBags', { data: init(Bags, ['address', 'address', 'address', 'address', 'address[]', 'uint256'], [A.kntq, swapper, me, TREASURY, days, BAG_MINT_KNTQ]) })).address;
  const airdrop = (await step('LootbagAirdrop', { data: init(Airdrop, ['address', 'address', 'address'], [A.kntq, swapper, me]) })).address;
  const router = (await step('LootbagRouter', { data: init(Router, ['address', 'address', 'address', 'address'], [A.pm, factory, swapper, A.whype]) })).address;

  await call('hook.init', hook, Hook, 'init', [factory, payout, bags, airdrop, TREASURY]);
  await call('payout.init', payout, Payout, 'init', [factory, hook, swapper]);
  await call('payout.setKeeper', payout, Payout, 'setKeeper', [KEEPER, true]);
  await call('bags.setKeeper', bags, Bags, 'setKeeper', [KEEPER, true]);
  await call('airdrop.setKeeper', airdrop, Airdrop, 'setKeeper', [KEEPER, true]);
  for (const q of quotes) await call(`quote ${q.sym}`, factory, Factory, 'setQuote', [q.token, true, q.tick, q.minDevBuy]);
  for (const [sym, token] of rewards) await call(`reward ${sym}`, factory, Factory, 'setReward', [token, true]);
  // Queueing a route that is already set would only queue a 48-hour change to the same thing, so a route found
  // on-chain (from a run that was cut off before it could be recorded) is marked done instead of sent again.
  const swapperRead = new ethers.Contract(swapper, Swapper.abi, P);
  for (const r of routes) {
    if (!prog.steps[r.name] && (await swapperRead.route(r.tokenIn, r.tokenOut)).length !== 0) {
      prog.steps[r.name] = { nonce: -1, hash: 'already set on-chain', done: true, block: 0, gas: 0 };
      save();
      console.log(`  ${r.name.padEnd(26)} already set`);
      continue;
    }
    await call(r.name, swapper, Swapper, 'queueRoute', [r.tokenIn, r.tokenOut, r.hops]);
  }

  const owned = { factory: [factory, Factory], hook: [hook, Hook], payout: [payout, Payout], swapper: [swapper, Swapper], bags: [bags, Bags], airdrop: [airdrop, Airdrop] };
  if (!eq(me, OWNER)) for (const [n, [addr, a]] of Object.entries(owned)) await call(`offer ${n}`, addr, a, 'transferOwnership', [OWNER]);

  const gasUsed = Object.values(prog.steps).reduce((s, x) => s + BigInt(x.gas || 0), 0n);
  const out = {
    chainId, deployer: me, owner: OWNER, ownershipAccepted: eq(me, OWNER), treasury: TREASURY, keeper: KEEPER,
    startBlock: prog.steps.LootbagFactory.block,
    launchesPaused: 'set by the owner from the admin page; read factory.paused() for the current value',
    liquidity: 'held by the factory; the owner can withdraw any share of a pool with collect(coin, bps, to)',
    launchBlock: "a coin's launch block is Elysium's own block number, read from ArbSys",
    hub: A.whype,
    contracts: { factory, hook, payout, swapper, bags, airdrop, router, poolManager: A.pm },
    tokens: { kntq: A.kntq, whype: A.whype },
    kntqPool: KNTQ_POOL,
    quotes: quotes.map((q) => ({ symbol: q.sym, token: q.token, startTick: q.tick, minDevBuy: q.minDevBuy.toString(), opensAtUsd: Math.round(q.opensAtUsd) })),
    fees: { launchFeeHype: ethers.formatEther(LAUNCH_FEE), copyFeeHype: ethers.formatEther(COPY_FEE), bagMintKntq: ethers.formatEther(BAG_MINT_KNTQ) },
    prices: { hypeUsd, kntqUsd, kntqPerHype, startMcapUsd: START_MCAP_USD },
    rewards: Object.fromEntries(rewards),
    bagDays: BAG_DAYS,
    routes: routes.length,
    gasUsed: gasUsed.toString(),
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
  console.log(`\ndone: ${Object.keys(prog.steps).length} transactions, ${gasUsed} gas. Saved ${path.relative(process.cwd(), OUT)}`);
  console.log('\nStill to do, from the owner wallet:');
  if (!eq(me, OWNER)) console.log(`  1. acceptOwnership() on all six contracts (until then ${me} is still their owner)`);
  console.log('  2. launch $LOOT, then bags.setLoot, bags.setDays with $LOOT in it, factory.setReward($LOOT) and a WHYPE>$LOOT route');
  console.log('  3. factory.setPaused(false) to open launches');
})().catch((e) => { console.error('\nFAILED:', e.message || e); process.exit(1); });
