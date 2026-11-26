// Deploys Lootbag on Base (or a Base fork with BASE_RPC): the route swapper, the payout contract, the hook at a
// CREATE2 address carrying its permission flags, the factory, the Bags and the airdrop pot. Wires them, lists the
// tokens (VVV, WETH, USDC and every Base stock token whose USDC pool checks out) both as quotes a coin can be paired
// with, each at an opening tick worked out from live pool prices, and as rewards holders can be paid in. Sets one
// route into USDC and one out of it per token (the swapper joins the two for any pair), makes the owner wallet a
// keeper (rounds are run by hand from the admin page), and offers ownership of all six contracts to the owner wallet.
// The factory stays paused until the owner opens launches. Resumable: steps done are kept in
// deployments/lootbag-base.progress.json.
//
//   forge build --skip test          (or: npx @foundry-rs/forge build --skip test)
//   node deploy.cjs                  dry run: prices, opening ticks, the plan and a gas estimate; sends nothing
//   KEYFILE=../../contracts/.env.deployer.lootbag node deploy.cjs --send
//
// Optional env: BASE_RPC, LOOTBAG_OWNER, LOOTBAG_TREASURY, LOOTBAG_KEEPER, START_MCAP_USD (5000),
// MIN_DEV_BUY_ETH (0.005), MAX_STOCKS (all).
const fs = require('fs'), path = require('path');
const { ethers } = require('ethers');

const RPC = process.env.BASE_RPC || 'https://mainnet.base.org';
// the BuzzPad admin wallet, which also owns this repo's other Base deployments
const OWNER = ethers.getAddress(process.env.LOOTBAG_OWNER || '0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b');
const TREASURY = ethers.getAddress(process.env.LOOTBAG_TREASURY || OWNER);
const KEEPER = ethers.getAddress(process.env.LOOTBAG_KEEPER || OWNER);
const START_MCAP_USD = Number(process.env.START_MCAP_USD || 5000);
const MIN_DEV_BUY_ETH = Number(process.env.MIN_DEV_BUY_ETH || 0.005);
const MAX_STOCKS = process.env.MAX_STOCKS === undefined ? Infinity : Number(process.env.MAX_STOCKS);
const SEND = process.argv.includes('--send');

const A = {
  pm: '0x498581fF718922c3f8e6A244956aF099B2652b2b',
  create2: '0x4e59b44847b379578588920cA78FbF26c0B4956C',
  multicall: '0xcA11bde05977b3631167028862bE2a173976CA11',
  vvv: '0xacfE6019Ed1A7Dc6f7B508C02d1b04ec88cC21bf',
  usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  weth: '0x4200000000000000000000000000000000000006',
  vvvUsdc: '0x67A11022B7B6ed66f81233F6C8Ed6e48F7826530', // Uniswap v3 0.3%
  wethUsdc: '0xb2cc224c1c9feE385f8ad6a55b4d94E92359DC59', // Aerodrome Slipstream
};
// beforeInitialize | beforeAddLiquidity | beforeRemoveLiquidity | beforeSwap | afterSwap | both swap return deltas
const HOOK_FLAGS = 0x2accn, FLAG_MASK = 0x3fffn;
const TICK_SPACING = 200, SUPPLY_WHOLE = 1e9;
// the Bag pot's day list at deploy; $LOOT joins it once it has launched (bags.setDays)
const BAG_DAYS = ['VVV', 'NVDA', 'AMZN', 'TSLA'];

const AC = ethers.AbiCoder.defaultAbiCoder();
const eq = (a, b) => a.toLowerCase() === b.toLowerCase();
const art = (n) => {
  const f = path.join(__dirname, 'out', n + '.sol', n + '.json');
  if (!fs.existsSync(f)) throw new Error(`no build output for ${n}: run "forge build --skip test" in ${__dirname} first`);
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  return { abi: j.abi, bytecode: j.bytecode.object, iface: new ethers.Interface(j.abi) };
};
const DEP = path.join(__dirname, 'deployments');
const PROG = path.join(DEP, 'lootbag-base.progress.json'), OUT = path.join(DEP, 'lootbag-base.json');
const prog = fs.existsSync(PROG) ? JSON.parse(fs.readFileSync(PROG, 'utf8')) : { steps: {} };
const save = () => fs.writeFileSync(PROG, JSON.stringify(prog, null, 1));

(async () => {
  const P = new ethers.JsonRpcProvider(RPC, undefined, { staticNetwork: true });
  const chainId = Number((await P.getNetwork()).chainId);
  if (chainId !== 8453 && !process.env.ALLOW_CHAIN) throw new Error(`chain ${chainId} is not Base (8453); set ALLOW_CHAIN=1 for a fork that reports another id`);

  let w = null, me = OWNER;
  if (SEND) {
    const keyFile = process.env.KEYFILE || path.join(__dirname, '../../contracts/.env.deployer.lootbag');
    const m = fs.readFileSync(keyFile, 'utf8').match(/PRIVATE_KEY=(0x)?([0-9a-fA-F]{64})/);
    if (!m) throw new Error('no PRIVATE_KEY=... in ' + keyFile);
    w = new ethers.Wallet('0x' + m[2], P);
    me = w.address;
  }
  console.log(`${SEND ? 'deployer ' + me + ', ' + ethers.formatEther(await P.getBalance(me)) + ' ETH' : 'DRY RUN (nothing is sent)'}`);
  console.log(`owner ${OWNER}  treasury ${TREASURY}  keeper ${KEEPER}`);

  // ---------------------------------------------------------------- live prices -> quotes
  const mc = new ethers.Contract(A.multicall, ['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) view returns ((bool success,bytes returnData)[])'], P);
  const sel = (sig) => ethers.id(sig).slice(0, 10);
  const poolInfo = async (pools) => {
    const calls = pools.flatMap((p) => ['slot0()', 'token0()', 'token1()'].map((s) => ({ target: p, allowFailure: true, callData: sel(s) })));
    const out = [];
    for (let i = 0; i < calls.length; i += 150) out.push(...(await mc.aggregate3(calls.slice(i, i + 150))));
    return pools.map((p, i) => {
      const [s, t0, t1] = out.slice(i * 3, i * 3 + 3);
      if (!s.success || !t0.success || !t1.success || s.returnData.length < 66) return null;
      return { pool: p, sqrt: BigInt('0x' + s.returnData.slice(2, 66)), token0: AC.decode(['address'], t0.returnData)[0], token1: AC.decode(['address'], t1.returnData)[0] };
    });
  };
  // price of `token` in the pool's other token, in whole units
  const priceIn = (info, token, decToken, decOther) => {
    const raw = (Number(info.sqrt) / 2 ** 96) ** 2; // token1 per token0, base units
    const perBase = eq(info.token0, token) ? raw : 1 / raw;
    return perBase * 10 ** (decToken - decOther);
  };
  const [vvvPool, wethPool] = await poolInfo([A.vvvUsdc, A.wethUsdc]);
  if (!vvvPool || !wethPool) throw new Error('could not read the VVV/USDC or WETH/USDC pool');
  const vvvUsd = priceIn(vvvPool, A.vvv, 18, 6), ethUsd = priceIn(wethPool, A.weth, 18, 6);
  console.log(`prices: VVV $${vvvUsd.toFixed(3)}  ETH $${ethUsd.toFixed(2)}`);
  if (!(vvvUsd > 0.01 && vvvUsd < 1e5 && ethUsd > 100 && ethUsd < 1e6)) throw new Error('a pool price looks wrong; stopping');

  // the opening tick as the factory wants it: the tick when the coin is currency0 (coin priced in the quote)
  const sig2 = (v) => { const s = v.toString(), z = BigInt(Math.max(0, s.length - 2)); return (v / 10n ** z) * 10n ** z; };
  const quoteCfg = (sym, token, usd, dec) => {
    const mcapBase = (START_MCAP_USD / usd) * 10 ** dec;
    const tick = Math.round(Math.log(mcapBase / (SUPPLY_WHOLE * 1e18)) / Math.log(1.0001) / TICK_SPACING) * TICK_SPACING;
    const minDevBuy = sig2(BigInt(Math.round(((MIN_DEV_BUY_ETH * ethUsd) / usd) * 10 ** dec)));
    const opensAtUsd = (1.0001 ** tick * SUPPLY_WHOLE * 1e18) / 10 ** dec * usd;
    return { sym, token, dec, tick, minDevBuy, opensAtUsd };
  };

  // ---------------------------------------------------------------- stocks with a usable USDC pool
  // A stock is used when its pool really is USDC/stock. It is also listed as a quote when the pool's price is within
  // 25% of the price recorded in the list (a thin pool can sit far from the real price, and a coin's opening tick is
  // worked out from it); otherwise it is a reward only.
  const stockFile = JSON.parse(fs.readFileSync(path.join(DEP, 'base-stock-routes.json'), 'utf8'));
  const cands = Object.entries(stockFile).filter(([, v]) => v.usdcPool && v.usdcPool.pool).map(([sym, v]) => ({ sym, token: ethers.getAddress(v.addr), pool: ethers.getAddress(v.usdcPool.pool), dec: v.dec, px: v.px }));
  const infos = await poolInfo(cands.map((c) => c.pool));
  const stocks = [], skipped = [], rewardOnly = [];
  cands.forEach((c, i) => {
    const f = infos[i];
    const ok = f && ((eq(f.token0, A.usdc) && eq(f.token1, c.token)) || (eq(f.token1, A.usdc) && eq(f.token0, c.token)));
    if (!ok) return skipped.push(c);
    c.usd = priceIn(f, c.token, c.dec, 6);
    c.quotable = c.usd > 0 && c.px > 0 && Math.abs(c.usd / c.px - 1) <= 0.25;
    if (!c.quotable) rewardOnly.push(c);
    stocks.push(c);
  });
  stocks.splice(MAX_STOCKS);
  console.log(`stocks: ${stocks.length} with a checked USDC pool${skipped.length ? `; skipped ${skipped.map((s) => s.sym).join(', ')} (pool is not USDC/stock)` : ''}`);
  if (rewardOnly.length) console.log(`  reward only, not a quote (pool price far from the listed price): ${rewardOnly.map((s) => `${s.sym} $${s.usd.toPrecision(4)} vs $${s.px}`).join(', ')}`);

  const quotes = prog.quotes
    ? prog.quotes.map((q) => ({ ...q, minDevBuy: BigInt(q.minDevBuy) }))
    : [quoteCfg('VVV', A.vvv, vvvUsd, 18), quoteCfg('WETH', A.weth, ethUsd, 18), quoteCfg('USDC', A.usdc, 1, 6), ...stocks.filter((s) => s.quotable).map((s) => quoteCfg(s.sym, s.token, s.usd, s.dec))];
  for (const q of quotes.slice(0, 6)) console.log(`quote ${q.sym.padEnd(5)} opens at tick ${q.tick} (~$${Math.round(q.opensAtUsd)} market cap), min dev buy ${ethers.formatUnits(q.minDevBuy, q.dec)} ${q.sym}`);
  if (quotes.length > 6) console.log(`  ... and ${quotes.length - 6} more stock quotes, each opening near $${START_MCAP_USD}`);
  const bySym = Object.fromEntries([['VVV', A.vvv], ['WETH', A.weth], ['USDC', A.usdc], ...stocks.map((s) => [s.sym, s.token])]);
  const days = BAG_DAYS.filter((s) => bySym[s]).map((s) => bySym[s]);
  if (days.length !== BAG_DAYS.length) console.log(`note: Bag days without a route were left out; using ${BAG_DAYS.filter((s) => bySym[s]).join(', ')}`);

  // routes: each token gets one route into USDC and one out of it; the swapper joins the two for any pair
  const v3 = (pool) => ({ kind: 0, pool, key: [ethers.ZeroAddress, ethers.ZeroAddress, 0, 0, ethers.ZeroAddress] });
  const rewards = [['VVV', A.vvv], ['WETH', A.weth], ['USDC', A.usdc], ...stocks.map((s) => [s.sym, s.token])];
  const routes = [];
  for (const [sym, token, pool] of [['VVV', A.vvv, A.vvvUsdc], ['WETH', A.weth, A.wethUsdc], ...stocks.map((s) => [s.sym, s.token, s.pool])]) {
    routes.push({ name: `route ${sym}>USDC`, tokenIn: token, tokenOut: A.usdc, hops: [v3(pool)] });
    routes.push({ name: `route USDC>${sym}`, tokenIn: A.usdc, tokenOut: token, hops: [v3(pool)] });
  }
  console.log(`plan: 6 contracts, ${quotes.length} quotes, ${rewards.length} rewards, ${routes.length} routes${eq(me, OWNER) ? '' : ', 6 ownership offers'}`);

  // ---------------------------------------------------------------- contracts
  const Swapper = art('LootbagSwapper'), Payout = art('LootbagPayout'), Hook = art('LootbagHook'), Factory = art('LootbagFactory'), Bags = art('LootbagBags'), Airdrop = art('LootbagAirdrop');
  const init = (a, types, args) => a.bytecode + AC.encode(types, args).slice(2);
  const hookInit = init(Hook, ['address', 'address'], [A.pm, me]);
  if (prog.hookFor !== me) { delete prog.hookSalt; delete prog.hook; }
  if (!prog.hookSalt) {
    const h = ethers.keccak256(hookInit);
    for (let i = 0n; ; i++) {
      const s = ethers.zeroPadValue(ethers.toBeHex(i), 32), a = ethers.getCreate2Address(A.create2, s, h);
      if ((BigInt(a) & FLAG_MASK) === HOOK_FLAGS && (await P.getCode(a)) === '0x') { prog.hookSalt = s; prog.hook = a; prog.hookFor = me; break; }
    }
    if (SEND) save();
  }
  console.log('hook will be', prog.hook);

  if (!SEND) {
    let gas = 0n;
    for (const [n, data, to] of [
      ['LootbagSwapper', init(Swapper, ['address', 'address', 'address'], [A.pm, me, A.usdc])],
      ['LootbagPayout', init(Payout, ['address'], [me])],
      ['LootbagHook', prog.hookSalt + hookInit.slice(2), A.create2],
      ['LootbagAirdrop', init(Airdrop, ['address', 'address', 'address'], [A.vvv, A.multicall, me])],
    ]) {
      const est = await P.estimateGas({ from: me, to, data });
      gas += est;
      console.log(`  ${n.padEnd(18)} ~${est} gas`);
    }
    const gp = (await P.getFeeData()).gasPrice || 0n;
    // measured on a Base fork: the whole run (267 transactions, 35.4M gas) is about 7 times these four deployments
    console.log(`dry run: these four are ~${gas} gas; the full run is roughly ${gas * 7n} gas, about ${ethers.formatEther(gas * 7n * gp)} ETH at the current ${ethers.formatUnits(gp, 'gwei')} gwei. Add --send to deploy.`);
    return;
  }

  // A public RPC can refuse a request for being over its rate limit. Reads are simply tried again; once a
  // transaction has been sent, only its receipt is polled, so a refused request can never send it twice.
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const retry = async (fn) => {
    for (let i = 0; ; i++) {
      try { return await fn(); } catch (e) {
        const m = String((e && (e.shortMessage || e.message)) || e);
        if (i >= 8 || !/limit|429|timeout|coalesce|ECONNRESET|ETIMEDOUT|50[234]|missing response/i.test(m)) throw e;
        await pause(1500 * (i + 1));
      }
    }
  };
  let nonce = await retry(() => P.getTransactionCount(me, 'pending'));
  const step = async (name, tx) => {
    if (prog.steps[name]) return prog.steps[name];
    const est = await retry(() => P.estimateGas({ from: me, ...tx })).catch((e) => { throw new Error(name + ': ' + (e.shortMessage || e.message)); });
    const fee = await retry(() => P.getFeeData());
    const sent = await w.sendTransaction({ ...tx, nonce: nonce++, gasLimit: (est * 12n) / 10n + 50000n, maxFeePerGas: (fee.maxFeePerGas || fee.gasPrice) * 2n, maxPriorityFeePerGas: fee.maxPriorityFeePerGas || 1000000n });
    let r = null;
    for (let i = 0; i < 90 && !r; i++) { await pause(i ? 2000 : 1200); r = await retry(() => P.getTransactionReceipt(sent.hash)); }
    if (!r) throw new Error(name + ' was sent but is not confirmed yet: ' + sent.hash + '. Run again to continue.');
    if (r.status !== 1) throw new Error(name + ' reverted ' + sent.hash);
    prog.steps[name] = { hash: sent.hash, block: r.blockNumber, gas: Number(r.gasUsed), address: r.contractAddress || undefined };
    save();
    console.log(`  ${name.padEnd(26)} ok ${r.gasUsed} gas`);
    return prog.steps[name];
  };
  const call = (name, to, a, fn, args) => step(name, { to, data: a.iface.encodeFunctionData(fn, args) });
  prog.quotes = prog.quotes || quotes.map((q) => ({ ...q, minDevBuy: q.minDevBuy.toString() }));
  save();

  const swapper = (await step('LootbagSwapper', { data: init(Swapper, ['address', 'address', 'address'], [A.pm, me, A.usdc]) })).address;
  const payout = (await step('LootbagPayout', { data: init(Payout, ['address'], [me]) })).address;
  await step('LootbagHook', { to: A.create2, data: prog.hookSalt + hookInit.slice(2) });
  const hook = prog.hook;
  if ((await P.getCode(hook)) === '0x') throw new Error('the hook did not land at ' + hook);
  const factory = (await step('LootbagFactory', { data: init(Factory, ['address', 'address', 'address', 'address', 'address'], [A.pm, hook, payout, me, TREASURY]) })).address;
  const bags = (await step('LootbagBags', { data: init(Bags, ['address', 'address', 'address', 'address', 'address[]'], [A.vvv, swapper, me, TREASURY, days]) })).address;
  const airdrop = (await step('LootbagAirdrop', { data: init(Airdrop, ['address', 'address', 'address'], [A.vvv, swapper, me]) })).address;

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
    if (!prog.steps[r.name] && (await retry(() => swapperRead.route(r.tokenIn, r.tokenOut))).length !== 0) {
      prog.steps[r.name] = { hash: 'already set on-chain', block: 0, gas: 0 };
      save();
      console.log(`  ${r.name.padEnd(26)} already set`);
      continue;
    }
    await call(r.name, swapper, Swapper, 'queueRoute', [r.tokenIn, r.tokenOut, r.hops]);
  }

  const owned = { factory: [factory, Factory], hook: [hook, Hook], payout: [payout, Payout], swapper: [swapper, Swapper], bags: [bags, Bags], airdrop: [airdrop, Airdrop] };
  if (!eq(me, OWNER)) for (const [n, [addr, a]] of Object.entries(owned)) await call(`offer ${n}`, addr, a, 'transferOwnership', [OWNER]);

  const gasUsed = Object.values(prog.steps).reduce((s, x) => s + BigInt(x.gas), 0n);
  const out = {
    chainId, deployer: me, owner: OWNER, ownershipAccepted: eq(me, OWNER), treasury: TREASURY, keeper: KEEPER,
    startBlock: prog.steps.LootbagFactory.block, launchesPaused: true,
    liquidity: 'held by the factory; the owner can withdraw any share of a pool with collect(coin, bps, to)',
    hub: A.usdc,
    contracts: { factory, hook, payout, swapper, bags, airdrop, poolManager: A.pm },
    tokens: { vvv: A.vvv, weth: A.weth, usdc: A.usdc },
    quotes: quotes.map((q) => ({ symbol: q.sym, token: q.token, startTick: q.tick, minDevBuy: q.minDevBuy.toString(), opensAtUsd: Math.round(q.opensAtUsd) })),
    prices: { vvvUsd, ethUsd, startMcapUsd: START_MCAP_USD },
    rewards: Object.fromEntries(rewards),
    bagDays: BAG_DAYS.filter((s) => bySym[s]),
    routes: routes.length,
    gasUsed: gasUsed.toString(),
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(`\ndone: ${Object.keys(prog.steps).length} transactions, ${gasUsed} gas. Saved ${path.relative(process.cwd(), OUT)}`);
  console.log('\nStill to do, from the owner wallet:');
  if (!eq(me, OWNER)) console.log(`  1. acceptOwnership() on all six contracts (until then ${me} is still their owner)`);
  console.log('  2. launch $LOOT, then bags.setLoot, bags.setDays with $LOOT in it, factory.setReward($LOOT) and a VVV>$LOOT route');
  console.log('  3. factory.setPaused(false) to open launches');
})().catch((e) => { console.error('\nFAILED:', e.message || e); process.exit(1); });
