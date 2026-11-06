// Zappy leverage funded by each coin's own pool (ZappyLocker lends passed-band ETH, ZappyMargin holds the positions) on
// a Robinhood Chain mainnet fork (node at 127.0.0.1:8550) with the stack deploy-v2.cjs put there:
//   KEYFILE=<hardhat #0> OWNER=0x7099…79C8 BRAND=zappytest LEVERAGE=1 RPC=http://127.0.0.1:8550 node deploy-v2.cjs --network robinhood --send
// Market trades go through Robinhood Chain's UniversalRouter with the calldata site/routes.js builds. Covers: no
// lending before a band is passed or on a thin pool, caps, open and close in profit with the loan back in the band,
// flag then liquidate after the delay, a pushed-and-restored price that cannot liquidate, a top-up clearing a flag,
// interest paid to the pool, a crash whose shortfall the pool absorbs, the owner's collect.
//   node test/zappy-leverage.fork.test.cjs
const { ethers } = require('ethers');
const ROUTES = require('../site/routes.js');
const dep = require('../deployments/zappytest-v2-robinhood-fork.json');
const RPC = process.env.FORK_RPC || 'http://127.0.0.1:8550';
const P = new ethers.JsonRpcProvider(RPC, undefined, { staticNetwork: true, cacheTimeout: -1 });
const UR = '0x8876789976decbfcbbbe364623c63652db8c0904', PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const KEYS = { owner: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', trader: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6', market: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a', keeper: '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba' };
const W = Object.fromEntries(Object.entries(KEYS).map(([k, v]) => [k, new ethers.NonceManager(new ethers.Wallet(v, P))]));
const art = (n) => require('../artifacts/' + n + '.json').abi;
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? '  ok   ' : '  FAIL ') + m); };
const E = (v) => ethers.parseEther(String(v)), f = (v) => Number(ethers.formatEther(v)).toLocaleString('en-US', { maximumFractionDigits: 6 });
const reverts = async (p, name) => { try { await p; return false; } catch (e) { const m = (e.shortMessage || '') + (e.message || ''); return !name || (e.revert && e.revert.name === name) || m.includes(name); } };
const later = async (s) => { await P.send('evm_increaseTime', [s]); await P.send('evm_mine', []); };

(async () => {
  const addr = {}; for (const k in W) addr[k] = await W[k].getAddress();
  for (const k in W) await P.send('hardhat_setBalance', [addr[k], '0x' + (1000n * 10n ** 18n).toString(16)]);
  const as = (n, a, w) => new ethers.Contract(a, art(n), w);
  const F = as('BuzzPadFactory', dep.factory, W.owner), L = as('ZappyLocker', dep.locker, W.owner), M = as('ZappyMargin', dep.leverage.margin, W.owner);
  for (const [n, a] of [['BuzzPadHook', dep.hook], ['BuzzPadFactory', dep.factory], ['ZappyLocker', dep.locker], ['ZappyMargin', dep.leverage.margin]]) await (await as(n, a, W.owner).acceptOwnership()).wait();
  ok((await L.margin()) === dep.leverage.margin && (await M.locker()) === dep.locker, 'locker lends only to the margin contract');
  ok(await reverts(L.setMargin.staticCall(addr.owner), 'AlreadyInitialized'), 'the locker cannot be pointed at another borrower');
  await (await F.setLaunchEnabled(true)).wait();
  await (await M.setOpensEnabled(true)).wait();

  const params = { name: 'Lev Test', symbol: 'LEVT', logo: 'https://x.test/l.png', description: '', socials: { twitter: '', telegram: '', discord: '', website: '', farcaster: '' }, creatorFeeRecipient: ethers.ZeroAddress, creatorTaxBps: 0, expectedEconomics: ethers.ZeroHash, salt: ethers.hexlify(ethers.randomBytes(32)), openingBuy: 0n, minTokensOut: 0n };
  const r = await (await as('BuzzPadFactory', dep.factory, W.trader).launch(params, 0, { value: await F.launchFee(), gasLimit: 3_000_000n })).wait();
  const coin = r.logs.map((l) => { try { return F.interface.parseLog(l); } catch { return null; } }).find((x) => x && x.name === 'TokenLaunched').args.token;
  const T = new ethers.Contract(coin, ['function balanceOf(address) view returns (uint256)', 'function approve(address,uint256) returns (bool)'], P);
  await later(20);
  const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 3600 * 24 * 400);
  const buy = async (w, eth) => (await w.sendTransaction({ to: UR, data: ROUTES.encode({ coin, pair: ethers.ZeroAddress, hook: dep.hook, pairInfo: null, buy: true, amountIn: E(eth), minOut: 1n, deadline: deadline() }), value: E(eth), gasLimit: 900_000n })).wait();
  const sell = async (w, amt) => (await w.sendTransaction({ to: UR, data: ROUTES.encode({ coin, pair: ethers.ZeroAddress, hook: dep.hook, pairInfo: null, buy: false, amountIn: amt, minOut: 1n, deadline: deadline() }), gasLimit: 900_000n })).wait();
  await (await T.connect(W.market).approve(PERMIT2, ethers.MaxUint256)).wait();
  await (await W.market.sendTransaction({ to: PERMIT2, data: new ethers.Interface(['function approve(address,address,uint160,uint48)']).encodeFunctionData('approve', [coin, UR, (1n << 160n) - 1n, Number(deadline())]) })).wait();
  const Mt = as('ZappyMargin', dep.leverage.margin, W.trader), Mk = as('ZappyMargin', dep.leverage.margin, W.keeper);

  for (let i = 0; i < 3; i++) await buy(W.market, 1);
  ok((await T.balanceOf(addr.market)) > 0n, 'market buys 3 ETH through Robinhood Chain\'s UniversalRouter');
  ok(await reverts(Mt.open.staticCall(coin, 30000, 0, { value: E(0.01) }), 'CoinTooNew'), 'no leverage in the first 10 minutes of a coin');
  await later(600);
  ok(await reverts(Mt.open.staticCall(coin, 30000, 0, { value: E(0.01) }), 'PoolTooThin'), `no leverage on a thin pool (${f(await M.poolDepth(coin))} ETH < 5 ETH)`);
  for (let i = 0; i < 12; i++) await buy(W.market, 1);
  const depth = await M.poolDepth(coin), passed = await L.passedEth(coin), room = await L.lendable(coin);
  ok(depth > E(5) && passed > 0n && room === (passed * 2000n) / 10000n, `after 15 ETH of buys: depth ${f(depth)} ETH, passed bands ${f(passed)} ETH, lendable ${f(room)} ETH (20%)`);
  const maxM = await M.maxMargin(coin, 30000);
  ok(maxM > 0n && await reverts(Mt.open.staticCall(coin, 30000, 0, { value: (maxM * 101n) / 100n }), ''), `max margin at 3x now ${f(maxM)} ETH; 1% more is refused`);
  ok(await reverts(Mt.open.staticCall(coin, 40000, 0, { value: E(0.01) }), 'InvalidLeverage'), 'no more than 3x');
  const m = (maxM * 9n) / 10n; // 90% of the largest position allowed
  const openPos = async (margin = m) => { const rc = await (await Mt.open(coin, 30000, 0, { value: margin, gasLimit: 2_000_000n })).wait(); return rc.logs.map((l) => { try { return M.interface.parseLog(l); } catch { return null; } }).find((x) => x && x.name === 'PositionOpened').args; };
  const passed0 = await L.passedEth(coin);
  let p = await openPos();
  let [debt, value, liq] = await M.health(p.id);
  ok(p.borrowed === m * 2n && !liq && (await L.lent(coin)) === p.borrowed, `3x long: margin ${f(m)}, borrowed ${f(p.borrowed)} from the coin's own pool, value ${f(value)}`);
  ok(passed0 - (await L.passedEth(coin)) >= p.borrowed - 10n ** 12n, 'the loan left the passed band');
  console.log(`         liquidation price ${Number(ethers.formatEther(await M.liquidationPrice(p.id))).toPrecision(4)} ETH per coin`);

  // price up, close in profit; the loan and its interest go back into the band
  await buy(W.market, 2);
  let e0 = await P.getBalance(addr.trader);
  let rc = await (await Mt.close(p.id, 0, { gasLimit: 2_000_000n })).wait();
  let back = (await P.getBalance(addr.trader)) - e0 + rc.gasUsed * rc.gasPrice;
  ok(back > m, `close after the price rose: ${f(back)} ETH back on ${f(m)} margin (${((Number(back) / Number(m) - 1) * 100).toFixed(1)}%)`);
  ok((await L.lent(coin)) === 0n && (await L.idle(coin)) < 10n ** 12n, `loan repaid and restaked into the pool (idle ${f(await L.idle(coin))})`);

  // price down: flag, wait, liquidate
  p = await openPos();
  const mk = await T.balanceOf(addr.market);
  let steps = 0; do { await sell(W.market, mk / 200n); steps++; [debt, value, liq] = await M.health(p.id); } while (!liq && steps < 120);
  ok(liq, `after ${steps} small sells: debt ${f(debt)} vs value ${f(value)}, liquidatable`);
  ok(await reverts(Mk.liquidate.staticCall(p.id), 'NotFlagged'), 'cannot liquidate without a flag');
  await (await Mk.flag(p.id)).wait();
  ok(await reverts(Mk.liquidate.staticCall(p.id), 'DelayNotElapsed'), 'cannot liquidate before the delay');
  await later(16);
  const k0 = await P.getBalance(addr.keeper), t0 = await P.getBalance(addr.trader);
  rc = await (await Mk.liquidate(p.id, { gasLimit: 2_000_000n })).wait();
  let ev = rc.logs.map((l) => { try { return M.interface.parseLog(l); } catch { return null; } }).find((x) => x && x.name === 'PositionLiquidated').args;
  ok((await P.getBalance(addr.keeper)) + rc.gasUsed * rc.gasPrice - k0 === ev.reward && ev.reward > 0n, `keeper paid ${f(ev.reward)} ETH`);
  ok(ev.shortfall === 0n && (await L.lent(coin)) === 0n, `pool repaid in full plus a ${f(ev.penalty)} ETH penalty (proceeds ${f(ev.proceeds)}, debt ${f(ev.debt)})`);
  ok((await P.getBalance(addr.trader)) - t0 === ev.toOwner, `trader gets the rest: ${f(ev.toOwner)}`);

  // a pushed-and-restored price cannot liquidate
  await buy(W.market, 3); await later(200);
  p = await openPos();
  const before = await T.balanceOf(addr.market), eb = await P.getBalance(addr.market);
  const rcd = await sell(W.market, before / 6n);
  const dumped = (await P.getBalance(addr.market)) - eb + rcd.gasUsed * rcd.gasPrice;
  ok((await M.health(p.id))[2], `attacker dumps for ${f(dumped)} ETH: position liquidatable for a moment`);
  await (await Mk.flag(p.id)).wait();
  await buy(W.market, ethers.formatEther((dumped * 108n) / 100n));
  ok(!(await M.health(p.id))[2], 'attacker buys back: healthy again');
  await later(16);
  ok(await reverts(Mk.liquidate.staticCall(p.id), 'Healthy'), 'liquidation after the delay refused: the price did not stay down');
  await (await Mk.flag(p.id)).wait();
  ok(Number((await M.positions(p.id)).flaggedAt) === 0, 'anyone can clear the stale flag');

  // a top-up clears a flag
  { const mk2 = await T.balanceOf(addr.market); let n = 0; while (!(await M.health(p.id))[2] && n++ < 120) await sell(W.market, mk2 / 200n); }
  await (await Mk.flag(p.id)).wait();
  [debt] = await M.health(p.id);
  await (await Mt.addMargin(p.id, { value: debt / 2n })).wait();
  ok(Number((await M.positions(p.id)).flaggedAt) === 0 && !(await M.health(p.id))[2], 'trader pays down half the debt: flag cleared, healthy');

  // interest, paid to the pool
  [debt] = await M.health(p.id);
  const pos = await M.positions(p.id);
  await later(30 * 86400);
  const [debt30] = await M.health(p.id);
  const want = (pos.principal * 2000n * 30n) / (10000n * 365n);
  ok(debt30 - debt >= (want * 99n) / 100n && debt30 - debt <= (want * 101n) / 100n, `30 days at 20% APR: debt ${f(debt)} -> ${f(debt30)}`);
  await buy(W.market, 4);
  const pe0 = await M.poolDepth(coin);
  rc = await (await Mt.close(p.id, 0, { gasLimit: 2_000_000n })).wait();
  ok(rc.status === 1 && (await L.lent(coin)) === 0n, 'closed with interest; nothing on loan');

  // a crash below the debt: the coin's pool takes the shortfall
  p = await openPos();
  await sell(W.market, await T.balanceOf(addr.market));
  [debt, value] = await M.health(p.id);
  console.log(`         crash: debt ${f(debt)} vs value ${f(value)}`);
  await (await Mk.flag(p.id)).wait(); await later(16);
  rc = await (await Mk.liquidate(p.id, { gasLimit: 2_000_000n })).wait();
  ev = rc.logs.map((l) => { try { return M.interface.parseLog(l); } catch { return null; } }).find((x) => x && x.name === 'PositionLiquidated').args;
  ok(rc.status === 1 && (await L.lent(coin)) === 0n && ev.shortfall > 0n, `deep liquidation goes through: proceeds ${f(ev.proceeds)}, debt ${f(ev.debt)}, shortfall taken by the pool ${f(ev.shortfall)}`);
  console.log(`         idle ETH waiting for a passed band: ${f(await L.idle(coin))}`);
  void pe0;

  // owner tools
  const o0 = await P.getBalance(addr.keeper);
  await (await L.collect(coin, 100, addr.keeper)).wait();
  ok((await P.getBalance(addr.keeper)) > o0, 'owner can still collect 1% of the liquidity');
  ok(await reverts(L.setLendCap.staticCall(6000), 'InvalidParams'), 'lend cap tops out at 50%');
  ok(await reverts(Mk.setOpensEnabled.staticCall(false), 'OwnableUnauthorizedAccount'), 'only the owner sets the switches');
  console.log(fails ? `FAILURES ${fails}` : 'ALL OK'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.shortMessage || e.message, e.revert || ''); process.exit(1); });
